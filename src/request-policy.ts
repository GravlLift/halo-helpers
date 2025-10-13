import { DelegateBackoff, handleType, retry, wrap } from 'cockatiel';
import { RequestError } from 'halo-infinite-api';

export const requestPolicy = wrap(
  retry(
    handleType(
      RequestError,
      (err) =>
        err.response.status >= 500 ||
        err.response.status === 401 ||
        err.response.status === 0 ||
        err.response.status === 429
    ).orType(
      TypeError,
      (err) =>
        err.message === 'NetworkError when attempting to fetch resource.' ||
        err.message === 'Failed to fetch' ||
        err.message === 'Load failed'
    ),
    {
      maxAttempts: 1,
      backoff: new DelegateBackoff((context) => {
        if (
          (context.result instanceof RequestError &&
            context.result.response.status === 0) ||
          context.result instanceof TypeError
        ) {
          // Add a little delay if the request failed due to a network error
          return 500;
        }
        return 0;
      }),
    }
  )
);
