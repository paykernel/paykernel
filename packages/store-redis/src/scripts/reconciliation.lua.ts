/**
 * Atomic Lua scripts for reconciliation store.
 * KEYS[1]=record KEYS[2]=due ZSET
 */

/** KEYS[1]=record KEYS[2]=dueIndex
 * ARGV: nowIso, subjectId, reason, dueAt, dueMs, logicalKey
 */
export const RECON_SCHEDULE_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowIso = ARGV[1]
local subjectId = ARGV[2]
local reason = ARGV[3]
local dueAt = ARGV[4]
local dueMs = ARGV[5]
local logicalKey = ARGV[6]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['subject_id'] or '',
    m['reason'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['due_at'] or '',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['last_error'] or ''
  }
end

if redis.call('EXISTS', rec) == 1 then
  local m = hgetall_map(rec)
  local status = m['status'] or ''
  -- RECON-7: reopen terminal rows under the same key; active stay already_exists.
  if status == 'completed' or status == 'failed' or status == 'manual_review' then
    redis.call('HSET', rec,
      'status', 'scheduled',
      'subject_id', subjectId,
      'reason', reason,
      'due_at', dueAt,
      'due_ms', dueMs,
      'lease_owner', '',
      'lease_token', '',
      'lease_expires_at', '',
      'lease_expires_ms', '0',
      'attempts', '0',
      'updated_at', nowIso,
      'last_error', ''
    )
    redis.call('ZADD', idx, tonumber(dueMs), logicalKey)
    m = hgetall_map(rec)
    local p = pack(m)
    return {'scheduled', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
  end
  local p = pack(m)
  return {'already_exists', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

redis.call('HSET', rec,
  'key', logicalKey,
  'status', 'scheduled',
  'subject_id', subjectId,
  'reason', reason,
  'due_at', dueAt,
  'due_ms', dueMs,
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'attempts', '0',
  'generation', '0',
  'created_at', nowIso,
  'updated_at', nowIso,
  'last_error', ''
)
redis.call('ZADD', idx, tonumber(dueMs), logicalKey)
local m = hgetall_map(rec)
local p = pack(m)
return {'scheduled', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
`.trim();

/** KEYS[1]=record KEYS[2]=dueIndex
 * ARGV: nowMs, nowIso, owner, leaseToken, leaseExpiresAt, leaseExpiresMs, logicalKey
 */
export const RECON_CLAIM_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local owner = ARGV[3]
local leaseToken = ARGV[4]
local leaseExpiresAt = ARGV[5]
local leaseExpiresMs = ARGV[6]
local logicalKey = ARGV[7]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['subject_id'] or '',
    m['reason'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['due_at'] or '',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['last_error'] or ''
  }
end

if redis.call('EXISTS', rec) == 0 then
  return {'not_found'}
end

local m = hgetall_map(rec)
local status = m['status'] or ''

if status == 'completed' or status == 'failed' or status == 'manual_review' then
  local p = pack(m)
  return {'already_terminal', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

if status == 'claimed' then
  local exp = tonumber(m['lease_expires_ms'] or '0') or 0
  if exp > nowMs then
    local p = pack(m)
    return {'in_progress', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
  end
  -- expired claim → treat as re-claimable scheduled-like
end

local dueMs = tonumber(m['due_ms'] or '0') or 0
if dueMs > nowMs then
  local p = pack(m)
  return {'not_due', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

local gen = (tonumber(m['generation'] or '0') or 0) + 1
local prevAttempts = tonumber(m['attempts'] or '0') or 0
-- P1315-REDIS-1 / STORES-1: only scheduled (handler retry) burns an attempt;
-- expired claimed reclaim is crash recovery and keeps attempts unchanged.
local attempts = prevAttempts
if status == 'scheduled' then
  attempts = prevAttempts + 1
end
redis.call('HSET', rec,
  'status', 'claimed',
  'lease_owner', owner,
  'lease_token', leaseToken,
  'lease_expires_at', leaseExpiresAt,
  'lease_expires_ms', leaseExpiresMs,
  'attempts', tostring(attempts),
  'generation', tostring(gen),
  'updated_at', nowIso
)
-- P1315-REDIS-2: keep claimed keys on the due index scored at lease expiry so
-- ZRANGEBYSCORE(-inf, now) rediscovers abandoned work with keyed ZSET ops
-- only (Cluster-safe, same hash tag). Complete/fail/manual_review still ZREM.
redis.call('ZADD', idx, tonumber(leaseExpiresMs), logicalKey)
m = hgetall_map(rec)
local p = pack(m)
return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], leaseToken}
`.trim();

/** KEYS[1]=record KEYS[2]=dueIndex ARGV: nowMs, nowIso, leaseToken, newToken, leaseExpiresAt, leaseExpiresMs */
export const RECON_RENEW_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local newToken = ARGV[4]
local leaseExpiresAt = ARGV[5]
local leaseExpiresMs = ARGV[6]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['subject_id'] or '',
    m['reason'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['due_at'] or '',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['last_error'] or ''
  }
end

if redis.call('EXISTS', rec) == 0 then
  return {'not_found'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'claimed' then
  local p = pack(m)
  return {'wrong_status', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

local exp = tonumber(m['lease_expires_ms'] or '0') or 0
if (m['lease_token'] or '') ~= leaseToken or exp <= nowMs then
  local p = pack(m)
  return {'lease_lost', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

local gen = (tonumber(m['generation'] or '0') or 0) + 1
redis.call('HSET', rec,
  'lease_token', newToken,
  'lease_expires_at', leaseExpiresAt,
  'lease_expires_ms', leaseExpiresMs,
  'generation', tostring(gen),
  'updated_at', nowIso
)
-- REDIS-1: rescore due ZSET to the new lease expiry so listDue
-- ZRANGEBYSCORE(-inf, now) does not keep the original claim score.
local logicalKey = m['key'] or ''
if idx ~= nil and idx ~= '' and logicalKey ~= '' then
  redis.call('ZADD', idx, tonumber(leaseExpiresMs), logicalKey)
end
m = hgetall_map(rec)
local p = pack(m)
return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], newToken}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=dueIndex ARGV: nowMs, nowIso, leaseToken, logicalKey, retentionTtlSec
 * retentionTtlSec is accepted for call-site parity but **ignored** (STORES-5):
 * completed recon fences must not EXPIRE into re-acquirable empty keys.
 */
export const RECON_COMPLETE_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local logicalKey = ARGV[4]
-- ARGV[5] retentionTtlSec intentionally unused for completed (STORES-5)
local _retentionTtlSec = tonumber(ARGV[5]) or 0

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'lease_lost'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'claimed' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end
local exp = tonumber(m['lease_expires_ms'] or '0') or 0
if exp <= nowMs then
  return {'lease_lost'}
end

redis.call('HSET', rec,
  'status', 'completed',
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'updated_at', nowIso
)
redis.call('ZREM', idx, logicalKey)
-- STORES-5: never EXPIRE completed recon fences (re-open → re-claim completed work).
-- retentionTtlSec accepted for API parity but ignored; use deleteExpired for cleanup.
redis.call('PERSIST', rec)
return {'ok'}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=dueIndex
 * ARGV: nowMs, nowIso, leaseToken, error, mode(retry|terminal), retryAt, retryMs, logicalKey, retentionTtlSec
 */
export const RECON_FAIL_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local err = ARGV[4]
local mode = ARGV[5]
local retryAt = ARGV[6]
local retryMs = ARGV[7]
local logicalKey = ARGV[8]
-- ARGV[9] retentionTtlSec intentionally unused for terminal failed (P1315-REDIS-3)
local _retentionTtlSec = tonumber(ARGV[9]) or 0

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'lease_lost'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'claimed' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end
-- RECON-LEASE-1 / WEBHOOKS-2: matching token on claimed is enough (accept after expiry).
-- Complete stays unexpired-only. Soft-release via GET/listDue clears token first.

if mode == 'retry' then
  redis.call('HSET', rec,
    'status', 'scheduled',
    'due_at', retryAt,
    'due_ms', retryMs,
    'last_error', err,
    'lease_owner', '',
    'lease_token', '',
    'lease_expires_at', '',
    'lease_expires_ms', '0',
    'updated_at', nowIso
  )
  redis.call('ZADD', idx, tonumber(retryMs), logicalKey)
else
  redis.call('HSET', rec,
    'status', 'failed',
    'last_error', err,
    'lease_owner', '',
    'lease_token', '',
    'lease_expires_at', '',
    'lease_expires_ms', '0',
    'updated_at', nowIso
  )
  redis.call('ZREM', idx, logicalKey)
  -- P1315-REDIS-3 / STORES-5: never EXPIRE terminal failed fences
  -- (re-open → re-claim completed/failed work). Cleanup via deleteExpired.
  -- retentionTtlSec accepted for API parity but ignored.
  redis.call('PERSIST', rec)
end
return {'ok'}
`.trim();

/** KEYS[1]=record KEYS[2]=dueIndex ARGV: nowMs, nowIso, leaseToken, note, logicalKey, retentionTtlSec */
export const RECON_MARK_MANUAL_REVIEW_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local note = ARGV[4]
local logicalKey = ARGV[5]
-- ARGV[6] retentionTtlSec intentionally unused for manual_review (P1315-REDIS-3)
local _retentionTtlSec = tonumber(ARGV[6]) or 0

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  return {'lease_lost'}
end

local m = hgetall_map(rec)
if (m['status'] or '') ~= 'claimed' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end
-- RECON-LEASE-1: matching token on claimed is enough (accept after expiry).

redis.call('HSET', rec,
  'status', 'manual_review',
  'last_error', note,
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'updated_at', nowIso
)
redis.call('ZREM', idx, logicalKey)
-- P1315-REDIS-3 / STORES-5: never EXPIRE manual_review fences.
-- retentionTtlSec accepted for API parity but ignored; use deleteExpired.
redis.call('PERSIST', rec)
return {'ok'}
`.trim();

/**
 * Shared get-one body (soft-release + ghost ZREM). Used by single GET and
 * PERF-4 list GET. rec/idx/nowMs/nowIso/listedKey are locals in the caller.
 */
const RECON_GET_ONE_LUA = `
local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

local function pack(m)
  return {
    m['key'] or '',
    m['status'] or '',
    m['subject_id'] or '',
    m['reason'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['due_at'] or '',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['last_error'] or ''
  }
end

local function recon_get_one(rec, idx, nowMs, nowIso, listedKey)
  if redis.call('EXISTS', rec) == 0 then
    -- NEW-STORE-1: drop ghost ZSET members so listDue LIMIT windows
    -- cannot fill with dead keys (hash gone, due member left).
    if idx ~= nil and idx ~= '' and listedKey ~= '' then
      redis.call('ZREM', idx, listedKey)
    end
    return {'missing'}
  end

  local m = hgetall_map(rec)
  if (m['status'] or '') == 'claimed' then
    local exp = tonumber(m['lease_expires_ms'] or '0') or 0
    local logicalKey = m['key'] or ''
    if exp <= nowMs then
      local dueMs = tonumber(m['due_ms'] or tostring(nowMs)) or nowMs
      -- P1315-REDIS-1: restore unfinished claim attempt so crash reclaim does not
      -- burn maxAttempts (parity with WEBHOOK_GET_LUA / memory soft-release).
      local attempts = tonumber(m['attempts'] or '0') or 0
      if attempts > 0 then
        attempts = attempts - 1
      end
      redis.call('HSET', rec,
        'status', 'scheduled',
        'lease_owner', '',
        'lease_token', '',
        'lease_expires_at', '',
        'lease_expires_ms', '0',
        'attempts', tostring(attempts),
        'updated_at', nowIso
      )
      if logicalKey ~= '' then
        redis.call('ZADD', idx, dueMs, logicalKey)
      end
      m = hgetall_map(rec)
    elseif logicalKey ~= '' then
      -- Heal a stale due score (pre-REDIS-1 renew left the original expiry).
      redis.call('ZADD', idx, exp, logicalKey)
    end
  end

  local p = pack(m)
  return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end
`.trim();

/**
 * KEYS[1]=record KEYS[2]=dueIndex
 * ARGV: nowMs, nowIso, logicalKey
 * Soft-release expired claim → scheduled and re-index so listDue sees it.
 * Missing hash ZREMs ARGV logicalKey from the due index (NEW-STORE-1).
 */
export const RECON_GET_LUA = `
${RECON_GET_ONE_LUA}
return recon_get_one(KEYS[1], KEYS[2], tonumber(ARGV[1]), ARGV[2], ARGV[3] or '')
`.trim();

/**
 * PERF-4: one EVAL for a ZRANGE page.
 * KEYS[1]=dueIndex KEYS[2..n+1]=record keys
 * ARGV: nowMs, nowIso, logicalKey1..logicalKeyN
 * Returns an array of tagged get results (same shape as RECON_GET_LUA each).
 * Same-slot KEYS (hash-tag / standalone). Cluster without clusterKeys already
 * CROSSSLOT on mutators — same constraint.
 */
export const RECON_LIST_GET_LUA = `
${RECON_GET_ONE_LUA}
local idx = KEYS[1]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local out = {}
for i = 2, #KEYS do
  out[i - 1] = recon_get_one(KEYS[i], idx, nowMs, nowIso, ARGV[i + 1] or '')
end
return out
`.trim();

/** KEYS[1]=record KEYS[2]=dueIndex ARGV: beforeIso, beforeMs, logicalKey */
export const RECON_DELETE_IF_EXPIRED_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
-- P1315-REDIS-5: beforeIso must be canonical millisecond UTC ISO (Z).
-- ARGV: beforeIso, beforeMs, logicalKey
local beforeIso = ARGV[1]
local beforeMs = tonumber(ARGV[2] or '')
local logicalKey = ARGV[3]

local function hgetall_map(key)
  local arr = redis.call('HGETALL', key)
  local m = {}
  for i = 1, #arr, 2 do
    m[arr[i]] = arr[i + 1]
  end
  return m
end

if redis.call('EXISTS', rec) == 0 then
  redis.call('ZREM', idx, logicalKey)
  return {'skipped'}
end

local m = hgetall_map(rec)
local status = m['status'] or ''
local updatedMs = tonumber(m['updated_ms'] or '')
if updatedMs ~= nil and beforeMs ~= nil then
  if updatedMs > beforeMs then
    return {'skipped'}
  end
else
  local updated = m['updated_at'] or ''
  if updated > beforeIso then
    return {'skipped'}
  end
end
if status == 'completed' or status == 'failed' or status == 'manual_review' then
  redis.call('DEL', rec)
  redis.call('ZREM', idx, logicalKey)
  return {'deleted'}
end
return {'skipped'}
`.trim();
