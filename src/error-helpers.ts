import { RequestError } from 'halo-infinite-api';

export function isRequestError(err: Error): err is RequestError {
  if (typeof err === 'string') {
    return false;
  }

  return (
    err instanceof RequestError ||
    ('response' in err &&
      err.response != null &&
      typeof err.response === 'object' &&
      'status' in err.response &&
      typeof err.response.status === 'number')
  );
}
