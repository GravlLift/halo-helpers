import {
  abortSignalAll,
  Fetchers,
  LayerCache,
  NullableFetcher,
} from '@gravllift/utilities';
import { DelegateBackoff, handleWhen, retry, wrap } from 'cockatiel';
import { HaloInfiniteClient, XboxClient } from 'halo-infinite-api';
import {
  bufferToggle,
  concatMap,
  delay,
  filter,
  firstValueFrom,
  map,
  merge,
  of,
  share,
  skip,
  Subject,
  take,
  tap,
  throttle,
  timer,
} from 'rxjs';
import { isRequestError } from '../error-helpers';
import { networkFailurePolicy } from '../request-policy';
import { compareXuids, unwrapXuid } from '../xuids';

export function createXuidCache(
  haloInfiniteClient: HaloInfiniteClient,
  xboxClient: XboxClient,
  options: {
    additionalXuidFetcher?: NullableFetcher<
      { xuid: string; gamertag: string },
      string
    >;
  }
) {
  const haloInfinite = {
    name: 'HaloInfiniteUserFetcher',
    fetch: (requests: { xuid: string; signal: AbortSignal }[]) =>
      haloInfiniteClient.getUsers(requests.map(({ xuid }) => xuid).distinct(), {
        signal: abortSignalAll(requests.map(({ signal }) => signal)),
      }),
    cooldownUntil: 0,
  };
  const xboxLive = {
    name: 'XboxLiveUserFetcher',
    fetch: (requests: { xuid: string; signal: AbortSignal }[]) =>
      xboxClient
        .getProfiles(
          requests.map(({ xuid }) => xuid).distinct(),
          ['Gamertag', 'GameDisplayPicRaw'],
          { signal: abortSignalAll(requests.map(({ signal }) => signal)) }
        )
        .then(({ profileUsers }) =>
          profileUsers.map((profile) => ({
            xuid: profile.id,
            gamertag:
              profile.settings.find((v) => v.id === 'Gamertag')?.value ?? '',
          }))
        ),
    cooldownUntil: 0,
  };

  const policy = wrap(
    retry(
      handleWhen((err) => isRequestError(err) && err.response.status === 429),
      {
        backoff: new DelegateBackoff(() => {
          // Snooze until either service is available again
          const now = Date.now();
          return Math.min(
            haloInfinite.cooldownUntil - now,
            xboxLive.cooldownUntil - now
          );
        }),
      }
    ),
    networkFailurePolicy
  );
  const xuidInputSubject = new Subject<{ xuid: string; signal: AbortSignal }>();

  let isFetching = false;
  const fetchCompleted$ = new Subject<void>();
  // Track XUIDs that are awaiting resolution (normalized)
  const awaitingXuids = new Set<string>();

  const xuidInput$ = xuidInputSubject.pipe(share());

  // Emit when a buffer closes to allow the next opening
  const bufferClosed$ = new Subject<void>();

  // Allow only one open buffer at a time: first item opens, further items are ignored until close
  const bufferOpen$ = xuidInput$.pipe(
    throttle(() => bufferClosed$, { leading: true, trailing: false })
  );

  // Ensure the opener request is included in the buffer:
  // we synthesize the opening item into the buffered source after the open event.
  const sourceForBuffer$ = merge(
    xuidInput$,
    bufferOpen$.pipe(concatMap((req) => of(req).pipe(delay(0))))
  );

  const xuidBuffer = sourceForBuffer$.pipe(
    bufferToggle(bufferOpen$, () => {
      return merge(
        // Close when 32 items collected
        xuidInput$.pipe(skip(31), take(1)),
        // Close if a new input arrives while not currently fetching (ready to flush)
        xuidInput$.pipe(filter(() => !isFetching)),
        // Close when a previous fetch completes (let next batch start)
        fetchCompleted$,
        // Close on time to avoid starvation
        timer(500)
      ).pipe(take(1));
    }),
    tap(() => {
      // Signal that the buffer closed so the next opening can occur
      bufferClosed$.next();
    }),
    concatMap(async (requests) => {
      isFetching = true;
      try {
        return await policy.execute(async () => {
          const now = Date.now();
          const chosenFetcher =
            // Prefer xbox live if its available
            xboxLive.cooldownUntil <= now ||
            // If both are on cooldown, use the one that will be available first
            xboxLive.cooldownUntil <= haloInfinite.cooldownUntil
              ? xboxLive
              : haloInfinite;
          try {
            return await chosenFetcher.fetch(requests);
          } catch (err) {
            if (
              err instanceof Error &&
              isRequestError(err) &&
              err.response.status === 429
            ) {
              let retryAfterSeconds = 30; // seconds fallback
              const raw =
                err.response.headers.get('retry-after') ??
                err.response.headers.get('Retry-After');
              if (raw != null) {
                const parsed = parseInt(String(raw), 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  retryAfterSeconds = parsed;
                }
              }

              const dateHeader = err.response.headers.get('date');
              const requestDate = dateHeader
                ? new Date(dateHeader).getTime()
                : Date.now();

              chosenFetcher.cooldownUntil =
                requestDate + retryAfterSeconds * 1000;
              console.warn(
                `Fetcher ${
                  chosenFetcher.name
                } is rate limited. Cooling down until ${new Date(
                  chosenFetcher.cooldownUntil
                ).toString()}.`
              );
            }

            throw err;
          }
        });
      } finally {
        isFetching = false;
        fetchCompleted$.next();
      }
    }),
    share()
  );

  const fetchers = [] as Array<
    NullableFetcher<{ xuid: string; gamertag: string }, string>
  >;
  if (options.additionalXuidFetcher) {
    fetchers.push(options.additionalXuidFetcher);
  }
  return new LayerCache({
    keyTransformer: (xuid: string) => unwrapXuid(xuid),
    fetchers: [
      ...fetchers,
      {
        fetchOneFn: (xuid: string, signal?: AbortSignal) => {
          const resultPromise = firstValueFrom(
            xuidBuffer.pipe(
              map((result) => result.find((u) => compareXuids(u.xuid, xuid))),
              filter(
                (result): result is { xuid: string; gamertag: string } =>
                  result != null
              ),
              tap(({ xuid }) => {
                awaitingXuids.delete(xuid);
              })
            )
          );

          if (!awaitingXuids.has(xuid)) {
            awaitingXuids.add(xuid);
            xuidInputSubject.next({
              xuid,
              signal: signal ?? new AbortController().signal,
            });
          }
          return resultPromise;
        },
      },
    ] as Fetchers<
      { xuid: string; gamertag: string },
      string,
      [],
      { xuid: string; gamertag: string }
    >,
  });
}
