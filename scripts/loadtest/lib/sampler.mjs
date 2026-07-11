// Resource sampler (Phase 6): once per second while a scenario runs, capture
//   • API + worker process CPU%/RSS (ps — macOS and Linux compatible flags)
//   • Redis ops/sec + memory (INFO via the same ioredis the API uses)
//   • Postgres commits/sec + cache hit ratio + active backends (pg_stat_*)
// Aggregated per scenario window so every latency table in the report has the
// resource picture that produced it.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function psSample(pids) {
  if (pids.length === 0) return {};
  try {
    const { stdout } = await execFileP('ps', ['-o', 'pid=,%cpu=,rss=', '-p', pids.join(',')]);
    const out = {};
    for (const line of stdout.trim().split('\n')) {
      const [pid, cpu, rssKb] = line.trim().split(/\s+/);
      out[pid] = { cpu: Number(cpu), rssMb: Math.round(Number(rssKb) / 1024) };
    }
    return out;
  } catch {
    return {}; // process exited mid-sample
  }
}

export class Sampler {
  /**
   * @param {{api?: number, worker?: number}} pids
   * @param {import('ioredis').Redis} redis
   * @param {{ $queryRawUnsafe: (q: string) => Promise<unknown[]> }} prisma
   * @param {string} dbName
   */
  constructor(pids, redis, prisma, dbName) {
    this.pids = pids;
    this.redis = redis;
    this.prisma = prisma;
    this.dbName = dbName;
    this.samples = [];
    this.timer = null;
  }

  async sampleOnce() {
    const [ps, redisInfo, pg] = await Promise.all([
      psSample(Object.values(this.pids).filter(Boolean)),
      this.redis.info().catch(() => ''),
      this.prisma
        .$queryRawUnsafe(
          `SELECT xact_commit, blks_read, blks_hit,
                  (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active') AS active
           FROM pg_stat_database WHERE datname = '${this.dbName}'`,
        )
        .catch(() => []),
    ]);

    const rInfo = Object.fromEntries(
      redisInfo.split('\r\n').filter((l) => l.includes(':')).map((l) => l.split(':')),
    );
    const pgRow = pg[0] ?? {};
    this.samples.push({
      t: Date.now(),
      api: ps[String(this.pids.api)] ?? null,
      worker: ps[String(this.pids.worker)] ?? null,
      redisOpsPerSec: Number(rInfo.instantaneous_ops_per_sec ?? 0),
      redisMemMb: Math.round(Number(rInfo.used_memory ?? 0) / 1024 / 1024),
      pgXactCommit: Number(pgRow.xact_commit ?? 0),
      pgBlksRead: Number(pgRow.blks_read ?? 0),
      pgBlksHit: Number(pgRow.blks_hit ?? 0),
      pgActive: Number(pgRow.active ?? 0),
    });
  }

  start(intervalMs = 1000) {
    this.samples = [];
    this.timer = setInterval(() => void this.sampleOnce(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    const s = this.samples;
    if (s.length < 2) return { samples: s.length };

    const nums = (f) => s.map(f).filter((v) => v != null && Number.isFinite(v));
    const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
    const max = (a) => (a.length ? Math.max(...a) : null);
    const spanSec = (s[s.length - 1].t - s[0].t) / 1000;

    // pg_stat counters are cumulative — report deltas over the window.
    const dCommits = s[s.length - 1].pgXactCommit - s[0].pgXactCommit;
    const dRead = s[s.length - 1].pgBlksRead - s[0].pgBlksRead;
    const dHit = s[s.length - 1].pgBlksHit - s[0].pgBlksHit;

    return {
      samples: s.length,
      api_cpu_avg_pct: avg(nums((x) => x.api?.cpu)),
      api_cpu_max_pct: max(nums((x) => x.api?.cpu)),
      api_rss_max_mb: max(nums((x) => x.api?.rssMb)),
      worker_cpu_avg_pct: avg(nums((x) => x.worker?.cpu)),
      worker_cpu_max_pct: max(nums((x) => x.worker?.cpu)),
      worker_rss_max_mb: max(nums((x) => x.worker?.rssMb)),
      redis_ops_per_sec_avg: avg(nums((x) => x.redisOpsPerSec)),
      redis_ops_per_sec_max: max(nums((x) => x.redisOpsPerSec)),
      redis_mem_max_mb: max(nums((x) => x.redisMemMb)),
      pg_commits_per_sec: Math.round((dCommits / spanSec) * 10) / 10,
      pg_cache_hit_pct: dRead + dHit > 0 ? Math.round((dHit / (dRead + dHit)) * 1000) / 10 : null,
      pg_active_backends_max: max(nums((x) => x.pgActive)),
    };
  }
}
