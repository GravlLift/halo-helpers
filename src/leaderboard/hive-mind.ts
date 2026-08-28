import { handleWhen, retry } from 'cockatiel';
import { BehaviorSubject, Subject, bufferTime, filter, map } from 'rxjs';
import {
  ActionProgress,
  ActionReceiver,
  ActionSender,
  BaseRoomConfig,
  DataPayload,
  RelayConfig,
  Room,
  defaultRelayUrls,
  joinRoom,
  selfId,
} from 'trystero/nostr';
import { KnowledgeMapLeaderboardProvider } from './knowledge-map-leaderboard';
import { KnowledgeMapLeaderboardEntry } from './entry';

type RoomLeaderboard = {
  room: Room;
  leaderboardProvider: KnowledgeMapLeaderboardProvider;
  reconnect: () => void;
};
let roomLeaderboard: RoomLeaderboard | undefined;

let sendCsrEntriesAction: PrettyAction<KnowledgeMapLeaderboardEntry[]>;
let requestEntriesAction: PrettyAction<Record<string, number> | null>;
const reconnectPolicy = retry(
  handleWhen(
    (e) =>
      e.name === 'InvalidStateError' || e.message.includes('InvalidStateError'),
  ),
  {
    maxAttempts: 2,
  },
);
reconnectPolicy.onFailure(({ handled }) => {
  if (handled) {
    roomLeaderboard?.reconnect();
  }
});

function checkConnection() {
  if (roomLeaderboard) {
    if (Object.keys(roomLeaderboard.room.getPeers()).length === 0) {
      roomLeaderboard.reconnect();
    } else {
      requestEntries();
    }
  }
}

if (typeof addEventListener === 'function') {
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkConnection();
    }
  });
}

interface PrettyAction<T> {
  send: ActionSender<T>;
  onReceive: ActionReceiver<T>;
  onProgress: ActionProgress;
}

function makePrettyAction<TData extends DataPayload>(
  room: Room,
  namespace: string,
): PrettyAction<TData> {
  const action = room.makeAction<TData>(namespace);
  return {
    send: action[0],
    onReceive: action[1],
    onProgress: action[2],
  };
}

const _peerStatus$ = new BehaviorSubject<Record<string, number | null>>({});
export const peerStatus$ = _peerStatus$.asObservable();
export { selfId };

const requestEntriesCalls = new Set<string>();
const peerJoined$ = new Subject<string>();

export function ensureJoin(
  leaderboard: KnowledgeMapLeaderboardProvider,
  rtcPolyfill?: unknown,
) {
  if (process.env['NEXT_PUBLIC_DISABLE_HIVE_MIND'] === 'true') {
    console.warn('Hive Mind is disabled via environment variable.');
    return;
  }

  try {
    roomLeaderboard = {
      room: joinRoom(
        {
          appId: 'halo-query',
          rtcPolyfill,
          relayUrls: defaultRelayUrls.filter(
            (url) =>
              ![
                'relay.oldenburg.cool',
                'relay.nostromo.social',
                'relay.nostraddress.com',
              ].some((badUrl) => url.includes(badUrl)),
          ),
        } as BaseRoomConfig & RelayConfig,
        'leaderboard-3',
      ),
      leaderboardProvider: leaderboard,

      reconnect() {
        if (roomLeaderboard) {
          roomLeaderboard.room.leave();
          roomLeaderboard = undefined;
          ensureJoin(leaderboard, rtcPolyfill);
        } else {
          console.error('No room to reconnect to');
        }
      },
    };
    sendCsrEntriesAction = makePrettyAction<KnowledgeMapLeaderboardEntry[]>(
      roomLeaderboard.room,
      'sendCsrs',
    );
    requestEntriesAction = makePrettyAction<Record<string, number> | null>(
      roomLeaderboard.room,
      'request',
    );

    roomLeaderboard.room.onPeerJoin(async (peerId) => {
      _peerStatus$.next({ ..._peerStatus$.value, [peerId]: null });
      peerJoined$.next(peerId);
    });
    roomLeaderboard.room.onPeerLeave((peerId) => {
      const { [peerId]: _, ...rest } = _peerStatus$.value;
      _peerStatus$.next(rest);
    });

    sendCsrEntriesAction.onProgress((percent, peerId) => {
      _peerStatus$.next({ ..._peerStatus$.value, [peerId]: percent });
    });
    sendCsrEntriesAction.onReceive(async (data, peerId) => {
      _peerStatus$.next({ ..._peerStatus$.value, [peerId]: null });
      await leaderboard.addLeaderboardEntries(data);
    });

    requestEntriesAction.onReceive(async (peerKnowledgeMap, peerId) => {
      if (requestEntriesCalls.has(peerId)) {
        return;
      }
      requestEntriesCalls.add(peerId);

      try {
        let entries: KnowledgeMapLeaderboardEntry[] = [];
        if (peerKnowledgeMap) {
          leaderboard.getCurrentKnowledge().then(async (knowledgeMap) => {
            for (const [key, value] of Object.entries(peerKnowledgeMap)) {
              const currentVersion = knowledgeMap.get(key) ?? -1;
              if (value > currentVersion) {
                try {
                  // Peer has more recent data than us, request their entries
                  await requestEntriesAction.send(
                    Object.fromEntries(knowledgeMap),
                    peerId,
                  );
                } catch (e) {
                  if (
                    e instanceof Error &&
                    e.message.includes('DataChannel is closed')
                  ) {
                    console.log(
                      `Could not send request to ${peerId} because their DataChannel is closed.`,
                    );
                  } else {
                    throw e;
                  }
                }
                return;
              }
            }
          });

          entries = await leaderboard.getDeltaEntries(peerKnowledgeMap);
        } else {
          entries = await leaderboard.getAllEntries();
        }

        if (entries.length > 0) {
          await sendEntriesToPeer(entries, peerId);
        }
      } catch (e) {
        console.error(e);
      } finally {
        requestEntriesCalls.delete(peerId);
      }
    });

    requestEntries();
  } catch (e) {
    if (
      e instanceof Error &&
      (e.message ===
        "Failed to construct 'RTCPeerConnection': Cannot create so many PeerConnections" ||
        ('errors' in e &&
          Array.isArray(e.errors) &&
          e.errors.some(
            (err) =>
              err.message ===
              "Failed to construct 'RTCPeerConnection': Cannot create so many PeerConnections",
          )))
    ) {
      return;
    }
    throw e;
  }
}

export function leave() {
  if (roomLeaderboard) {
    roomLeaderboard.room.leave();
    roomLeaderboard = undefined;
  }
}

// Don't send duplicate data to the same peer
const sendQueue = new Map<
  string,
  { entries: KnowledgeMapLeaderboardEntry[]; promise: Promise<void> }[]
>();
async function _sendEntriesToPeer(
  entries: KnowledgeMapLeaderboardEntry[],
  peerId: string,
) {
  await reconnectPolicy.execute(async () => {
    try {
      await sendCsrEntriesAction.send(entries, peerId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('DataChannel is closed')) {
        console.log(
          `Could not send request to ${peerId} because their DataChannel is closed.`,
        );
      } else {
        throw e;
      }
    }
  });
}

async function sendEntriesToPeer(
  entries: KnowledgeMapLeaderboardEntry[],
  peerId: string,
): Promise<void> {
  const peerRequestsInProcess = sendQueue.get(peerId) ?? [];

  for (const { entries: queueEntries, promise } of peerRequestsInProcess) {
    if (
      queueEntries.length === entries.length &&
      queueEntries.every((entry, i) => entry.matchId === entries[i].matchId)
    ) {
      return promise;
    }
  }

  const promise = _sendEntriesToPeer(entries, peerId);
  promise.finally(() => {
    if (peerRequestsInProcess.length === 1) {
      sendQueue.delete(peerId);
    } else {
      const idx = peerRequestsInProcess.findIndex(
        (qe) => qe.promise === promise,
      );
      peerRequestsInProcess.splice(idx, 1);
    }
  });
  peerRequestsInProcess.push({ entries, promise });
  sendQueue.set(peerId, peerRequestsInProcess);

  return promise;
}

const sendEntriesToAllSubject$ = new Subject<KnowledgeMapLeaderboardEntry[]>();
sendEntriesToAllSubject$
  .pipe(
    bufferTime(2000),
    map((e) => e.flat()),
    filter((e) => e.length > 0),
  )
  .subscribe((entries) => {
    if (!roomLeaderboard) {
      return;
    }

    for (const peerId of Object.keys(roomLeaderboard.room.getPeers())) {
      sendEntriesToPeer(entries, peerId);
    }
  });

export const sendLeaderboardEntriesToAllPeers = (
  data: KnowledgeMapLeaderboardEntry[],
) => {
  sendEntriesToAllSubject$.next(data);
};

const peerCount = 4;
export const requestEntries = async () => {
  if (!roomLeaderboard) {
    return;
  }

  // Choose peer(s) at random and request
  let peers = Object.keys(roomLeaderboard.room.getPeers());
  if (peers.length === 0) {
    console.warn('No peers available to request entries from.');
    return;
  }

  let chosenPeers: Set<string>;
  if (peers.length <= peerCount) {
    chosenPeers = new Set(peers);
  } else {
    chosenPeers = new Set();
    while (chosenPeers.size < peerCount) {
      const randomIndex = Math.floor(Math.random() * peers.length);
      chosenPeers.add(peers[randomIndex]);
      peers.splice(randomIndex, 1);
    }
  }
  const knowledgeMap =
    await roomLeaderboard.leaderboardProvider.getCurrentKnowledge();
  for (const peerId of chosenPeers) {
    if (!roomLeaderboard) {
      return;
    }
    await reconnectPolicy.execute(async () => {
      try {
        await requestEntriesAction.send(
          Object.fromEntries(knowledgeMap.entries()),
          peerId,
        );
      } catch (e) {
        if (e instanceof Error && e.message.includes('DataChannel is closed')) {
          console.log(
            `Could not send request to ${peerId} because their DataChannel is closed.`,
          );
        } else {
          throw e;
        }
      }
    });
  }
};
