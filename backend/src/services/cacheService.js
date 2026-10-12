import NodeCache from 'node-cache';

// Central in-memory cache instance: 60s default TTL, check period 120s
export const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 120,
  useClones: true,
});

// Cache statistics tracker
const stats = {
  hits: 0,
  misses: 0,
};

export const cacheService = {
  get: (key) => {
    const value = cache.get(key);
    if (value !== undefined) {
      stats.hits++;
      return value;
    }
    stats.misses++;
    return undefined;
  },

  set: (key, value, ttl) => {
    if (ttl !== undefined) {
      return cache.set(key, value, ttl);
    }
    return cache.set(key, value);
  },

  del: (keys) => {
    return cache.del(keys);
  },

  has: (key) => {
    return cache.has(key);
  },

  flush: () => {
    return cache.flushAll();
  },

  // Invalidate all tasks list and specific task cache if taskId provided
  invalidateTaskCaches: (taskId) => {
    cache.del('tasks:all');
    if (taskId) {
      cache.del(`tasks:id:${taskId}`);
    }
  },

  getStats: () => {
    const totalRequests = stats.hits + stats.misses;
    const hitRate = totalRequests > 0 ? Number(((stats.hits / totalRequests) * 100).toFixed(2)) : 0;
    return {
      hits: stats.hits,
      misses: stats.misses,
      totalRequests,
      hitRate,
    };
  },

  resetStats: () => {
    stats.hits = 0;
    stats.misses = 0;
  },
};

export default cacheService;
