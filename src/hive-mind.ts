import type {
  ILeaderboardProvider,
  LeaderboardEntry,
} from '@gravllift/halo-helpers';
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
  joinRoom,
  selfId,
} from 'trystero';

export type HiveMindLeaderboardProvider = Pick<
  ILeaderboardProvider,
  | 'addLeaderboardEntries'
  | 'getEntries'
  | 'getAllEntries'
  | 'getCurrentKnowledge'
  | 'getDeltaEntries'
  | 'getDiscovererId'
>;

type RoomLeaderboard = {
  room: Room;
  leaderboardProvider: HiveMindLeaderboardProvider;
  reconnect: () => void;
};
let roomLeaderboard: RoomLeaderboard | undefined;

let sendCsrEntriesAction: PrettyAction<LeaderboardEntry[]>;
let requestEntriesAction: PrettyAction<Record<string, number> | null>;
const reconnectPolicy = retry(
  handleWhen(
    (e) =>
      e.name === 'InvalidStateError' || e.message.includes('InvalidStateError')
  ),
  {
    maxAttempts: 2,
  }
);
reconnectPolicy.onFailure(({ handled }) => {
  if (handled) {
    roomLeaderboard?.reconnect();
  }
});

setInterval(() => {
  if (roomLeaderboard) {
    if (Object.keys(roomLeaderboard.room.getPeers()).length === 0) {
      roomLeaderboard.reconnect();
    } else {
      requestEntries();
    }
  }
}, 5000);

interface PrettyAction<T> {
  send: ActionSender<T>;
  onReceive: ActionReceiver<T>;
  onProgress: ActionProgress;
}

function makePrettyAction<TData extends DataPayload>(
  room: Room,
  namespace: string
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
  leaderboard: HiveMindLeaderboardProvider,
  rtcPolyfill: unknown
) {
  try {
    roomLeaderboard = {
      room: joinRoom(
        {
          appId: 'halo-query',
          rtcPolyfill,
        } as BaseRoomConfig & RelayConfig,
        'leaderboard-2'
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
    sendCsrEntriesAction = makePrettyAction<LeaderboardEntry[]>(
      roomLeaderboard.room,
      'sendCsrs'
    );
    requestEntriesAction = makePrettyAction<Record<string, number> | null>(
      roomLeaderboard.room,
      'request'
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
      console.debug(
        `[${peerId}]: Here are ${data.length} entries that I believe are new to you.`
      );
      leaderboard.addLeaderboardEntries(data);
    });

    requestEntriesAction.onReceive(async (peerKnowledgeMap, peerId) => {
      if (requestEntriesCalls.has(peerId)) {
        return;
      }
      requestEntriesCalls.add(peerId);

      try {
        let entries: LeaderboardEntry[] = [];
        if (peerKnowledgeMap) {
          console.debug(`[${peerId}]: My knowledge map is`, peerKnowledgeMap);
          entries = await leaderboard.getDeltaEntries(peerKnowledgeMap);
          const knowledgeMap = await leaderboard.getCurrentKnowledge();
          console.debug(`[self]: My knowledge map is`, knowledgeMap);
          if (entries.length > 0) {
            console.debug(
              `[self]: I know about ${entries.length} new entries that peer ${peerId} didn't know about.`
            );
          } else {
            console.debug(
              `[self]: I don't have any new entries to send to peer ${peerId}.`
            );
          }
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
              "Failed to construct 'RTCPeerConnection': Cannot create so many PeerConnections"
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
  { entries: LeaderboardEntry[]; promise: Promise<void> }[]
>();
async function _sendEntriesToPeer(entries: LeaderboardEntry[], peerId: string) {
  await reconnectPolicy.execute(() =>
    sendCsrEntriesAction.send(entries, peerId)
  );
}

async function sendEntriesToPeer(
  entries: LeaderboardEntry[],
  peerId: string
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
        (qe) => qe.promise === promise
      );
      peerRequestsInProcess.splice(idx, 1);
    }
  });
  peerRequestsInProcess.push({ entries, promise });
  sendQueue.set(peerId, peerRequestsInProcess);

  return promise;
}

const sendEntriesToAllSubject$ = new Subject<LeaderboardEntry[]>();
sendEntriesToAllSubject$
  .pipe(
    bufferTime(2000),
    map((e) => e.flat()),
    filter((e) => e.length > 0)
  )
  .subscribe((entries) => {
    if (!roomLeaderboard) {
      return;
    }

    for (const peerId of Object.keys(roomLeaderboard.room.getPeers())) {
      sendEntriesToPeer(entries, peerId);
    }
  });

export const sendLeaderboardEntriesToAllPeers = (data: LeaderboardEntry[]) => {
  sendEntriesToAllSubject$.next(data);
};

export const requestEntries = async () => {
  if (!roomLeaderboard) {
    return;
  }

  // Choose 4 peers at random and request
  let peers = Object.keys(roomLeaderboard.room.getPeers());
  if (peers.length === 0) {
    console.warn('No peers available to request entries from.');
    return;
  }

  let chosenPeers: Set<string>;
  if (peers.length <= 4) {
    chosenPeers = new Set(peers);
  } else {
    chosenPeers = new Set();
    while (chosenPeers.size < 4) {
      const randomIndex = Math.floor(Math.random() * peers.length);
      chosenPeers.add(peers[randomIndex]);
      peers = peers.splice(randomIndex, 1);
    }
  }
  const knowledgeMap =
    await roomLeaderboard.leaderboardProvider.getCurrentKnowledge();
  for (const peerId of chosenPeers) {
    if (!roomLeaderboard) {
      return;
    }
    await reconnectPolicy.execute(async () =>
      requestEntriesAction.send(
        Object.fromEntries(knowledgeMap.entries()),
        peerId
      )
    );
  }
};
