import { DelegateBackoff, handleType, retry, wrap } from 'cockatiel';
import { isRequestError } from './error-helpers';

export const requestPolicy = wrap(
  retry(
    handleType(
      TypeError,
      (err) =>
        err.message === 'NetworkError when attempting to fetch resource.' ||
        err.message === 'Failed to fetch' ||
        err.message === 'Load failed'
    ).orWhen(
      (err) =>
        isRequestError(err) &&
        (err.response.status >= 500 ||
          err.response.status === 401 ||
          err.response.status === 0 ||
          err.response.status === 429)
    ),
    {
      maxAttempts: 10,
      backoff: new DelegateBackoff((context) => {
        if ('error' in context.result) {
          if (context.result.error instanceof TypeError) {
            // Add a little delay if the request failed due to a network error
            return 500;
          }

          if (isRequestError(context.result.error)) {
            if (context.result.error.response.status === 0) {
              // Add a little delay if the request failed due to a network error
              return 500;
            } else if (context.result.error.response.status === 429) {
              const retryAfter =
                context.result.error.response.headers.get('Retry-After');
              if (retryAfter) {
                const retryAfterSeconds = parseInt(retryAfter, 10);
                if (!isNaN(retryAfterSeconds)) {
                  return retryAfterSeconds * 1000;
                }
              }
            }
          }
        }

        return 0;
      }),
    }
  )
);
