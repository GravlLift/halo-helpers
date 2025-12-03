import {
  DelegateBackoff,
  handleType,
  handleWhen,
  retry,
  wrap,
} from 'cockatiel';
import { isRequestError } from './error-helpers';

export const requestPolicy = wrap(
  retry(
    handleWhen((err) => isRequestError(err) && err.response.status === 429),
    {
      backoff: new DelegateBackoff((context) => {
        if (
          'error' in context.result &&
          isRequestError(context.result.error) &&
          context.result.error.response.status === 429
        ) {
          const retryAfter =
            context.result.error.response.headers.get('Retry-After');
          if (retryAfter) {
            const retryAfterSeconds = parseInt(retryAfter, 10);
            if (!isNaN(retryAfterSeconds)) {
              return retryAfterSeconds * 1000;
            }
          }
        }

        return 0;
      }),
    }
  ),
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
          err.response.status === 0)
    ),
    {
      maxAttempts: 3,
      backoff: new DelegateBackoff((context) => {
        if (
          'error' in context.result &&
          (context.result.error instanceof TypeError ||
            (isRequestError(context.result.error) &&
              context.result.error.response.status === 0))
        ) {
          // Add a little delay if the request failed due to a network error
          return 500;
        }

        return 0;
      }),
    }
  )
);
