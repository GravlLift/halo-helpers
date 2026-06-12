import { Redis } from '@upstash/redis';
let _redis: Redis | undefined;

export function getRedisInstance() {
  if (_redis === undefined) {
    const url =
      process.env['KV_REST_API_URL'] || process.env['UPSTASH_REDIS_REST_URL'];
    const token =
      process.env['KV_REST_API_TOKEN'] ||
      process.env['UPSTASH_REDIS_REST_TOKEN'];
    console.log('Redis URL:', url ? 'Provided' : 'Not provided');
    if (url && token) {
      _redis = new Redis({
        url,
        token,
        keepAlive: false,
      });
    } else {
      _redis = undefined;
    }
  }
  return _redis;
}
