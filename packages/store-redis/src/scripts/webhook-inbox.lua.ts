/**
 * Atomic Lua scripts for webhook inbox store.
 * KEYS[1]=record KEYS[2]=retry ZSET (optional for some ops; always pass both for mutators)
 */

/** KEYS[1]=record KEYS[2]=retryIndex
 * ARGV: nowMs, nowIso, payloadHash, owner, leaseToken, leaseExpiresAt, leaseExpiresMs, payloadRef, logicalKey
 */
export const WEBHOOK_CLAIM_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local payloadHash = ARGV[3]
local owner = ARGV[4]
local leaseToken = ARGV[5]
local leaseExpiresAt = ARGV[6]
local leaseExpiresMs = ARGV[7]
local payloadRef = ARGV[8]
local logicalKey = ARGV[9]

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
    m['payload_hash'] or '',
    m['payload_ref'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['available_at'] or '',
    m['last_error'] or ''
  }
end

local exists = redis.call('EXISTS', rec)
if exists == 0 then
  redis.call('HSET', rec,
    'key', logicalKey,
    'status', 'claimed',
    'payload_hash', payloadHash,
    'payload_ref', payloadRef,
    'lease_owner', owner,
    'lease_token', leaseToken,
    'lease_expires_at', leaseExpiresAt,
    'lease_expires_ms', leaseExpiresMs,
    'attempts', '1',
    'generation', '1',
    'created_at', nowIso,
    'updated_at', nowIso,
    'available_at', nowIso,
    'available_ms', tostring(nowMs),
    'last_error', ''
  )
  -- P1315-REDIS-2: score retry index at lease expiry (not ZREM) so
  -- ZRANGEBYSCORE(-inf, now) rediscovers abandoned claimed keys.
  redis.call('ZADD', idx, tonumber(leaseExpiresMs), logicalKey)
  local m = hgetall_map(rec)
  local p = pack(m)
  return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], leaseToken}
end

local m = hgetall_map(rec)
local status = m['status'] or ''
local ph = m['payload_hash'] or ''

-- WEBHOOKS-1: terminal outcomes before payload_hash_conflict (contract WEBHOOKS-4).
-- Completed/dead-letter redelivery with mismatched hash must ACK as already done,
-- not permanent payload_conflict (rawBody vs object-hash footgun).
if status == 'completed' then
  local p = pack(m)
  return {'already_completed', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

if status == 'dead_letter' or status == 'failed' then
  local p = pack(m)
  return {'duplicate_failed', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

if status == 'claimed' then
  local exp = tonumber(m['lease_expires_ms'] or '0') or 0
  if exp > nowMs then
    -- Active lease: hash mismatch cannot supersede; same hash is in_progress.
    if ph ~= payloadHash then
      local p = pack(m)
      return {'payload_hash_conflict', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
    end
    local p = pack(m)
    return {'in_progress', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
  end
  -- expired lease → fall through to re-claim (recovery / hash supersede)
elseif status == 'pending' then
  -- Same-hash backoff only; idle hash mismatch supersedes even during backoff.
  if ph == payloadHash then
    local avail = tonumber(m['available_ms'] or '0') or 0
    if avail > nowMs then
      local p = pack(m)
      return {'not_available', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
    end
  end
end

-- pending (available) or expired claim → re-claim
local gen = (tonumber(m['generation'] or '0') or 0) + 1
local prevAttempts = tonumber(m['attempts'] or '0') or 0
-- WEBHOOKS-1: only pending (handler retry) burns an attempt; expired claimed
-- reclaim is crash recovery and keeps attempts unchanged.
local attempts = prevAttempts
if status == 'pending' then
  attempts = prevAttempts + 1
end
local created = m['created_at'] or nowIso
local pref = payloadRef
if pref == '' then
  pref = m['payload_ref'] or ''
end
redis.call('HSET', rec,
  'status', 'claimed',
  'payload_hash', payloadHash,
  'payload_ref', pref,
  'lease_owner', owner,
  'lease_token', leaseToken,
  'lease_expires_at', leaseExpiresAt,
  'lease_expires_ms', leaseExpiresMs,
  'attempts', tostring(attempts),
  'generation', tostring(gen),
  'created_at', created,
  'updated_at', nowIso,
  'available_at', nowIso,
  'available_ms', tostring(nowMs)
)
-- P1315-REDIS-2: keep claimed keys on the retry index scored at lease expiry.
-- Complete/fail/dead_letter still ZREM. GET_LUA still soft-releases expired claimed.
redis.call('ZADD', idx, tonumber(leaseExpiresMs), logicalKey)
m = hgetall_map(rec)
local p = pack(m)
return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], leaseToken}
`.trim();

/** KEYS[1]=record ARGV: nowMs, nowIso, leaseToken, newToken, leaseExpiresAt, leaseExpiresMs */
export const WEBHOOK_RENEW_LUA = `
local rec = KEYS[1]
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
    m['payload_hash'] or '',
    m['payload_ref'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['available_at'] or '',
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
m = hgetall_map(rec)
local p = pack(m)
return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], newToken}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=retryIndex ARGV: nowMs, nowIso, leaseToken, logicalKey, retentionTtlSec
 * retentionTtlSec is accepted for call-site parity but **ignored** (STORES-5):
 * completed webhook fences must not EXPIRE into re-acquirable empty keys (reprocess paid).
 */
export const WEBHOOK_COMPLETE_LUA = `
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
-- STORES-5: never EXPIRE completed webhook fences (re-open → reprocess paid).
-- retentionTtlSec accepted for API parity but ignored; use deleteExpired for cleanup.
redis.call('PERSIST', rec)
return {'ok'}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=retryIndex
 * ARGV: nowMs, nowIso, leaseToken, error, deadLetter(0|1), availableAt, availableMs,
 *       logicalKey, retentionTtlSec, restoreAttempt(0|1)
 */
export const WEBHOOK_FAIL_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local err = ARGV[4]
local dead = ARGV[5]
local availableAt = ARGV[6]
local availableMs = ARGV[7]
local logicalKey = ARGV[8]
-- ARGV[9] retentionTtlSec intentionally unused for dead_letter (P1315-REDIS-3)
local _retentionTtlSec = tonumber(ARGV[9]) or 0
local restoreAttempt = ARGV[10] or '0'

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
-- WEBHOOKS-2: matching token on claimed is enough (accept after lease expiry so
-- hang/timeout handlers still record attempts). Soft-release clears token first.
if (m['status'] or '') ~= 'claimed' or (m['lease_token'] or '') ~= leaseToken then
  return {'lease_lost'}
end

local status = 'pending'
if dead == '1' then
  status = 'dead_letter'
end

local attempts = tonumber(m['attempts'] or '0') or 0
if restoreAttempt == '1' then
  attempts = math.max(0, attempts - 1)
end

redis.call('HSET', rec,
  'status', status,
  'last_error', err,
  'lease_owner', '',
  'lease_token', '',
  'lease_expires_at', '',
  'lease_expires_ms', '0',
  'available_at', availableAt,
  'available_ms', availableMs,
  'attempts', tostring(attempts),
  'updated_at', nowIso
)

if status == 'pending' then
  redis.call('ZADD', idx, tonumber(availableMs), logicalKey)
else
  redis.call('ZREM', idx, logicalKey)
  -- P1315-REDIS-3 / STORES-5: never EXPIRE dead_letter fences
  -- (re-open → reprocess paid). retentionTtlSec accepted for API parity
  -- but ignored; use deleteExpired for cleanup.
  redis.call('PERSIST', rec)
end
return {'ok'}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=retryIndex
 * ARGV: nowMs, nowIso
 * Soft-release expired claim → pending and re-index so listRetryable sees it.
 */
export const WEBHOOK_GET_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]

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
    m['payload_hash'] or '',
    m['payload_ref'] or '',
    m['lease_owner'] or '',
    m['lease_token'] or '',
    m['lease_expires_at'] or '',
    m['attempts'] or '0',
    m['generation'] or '0',
    m['created_at'] or '',
    m['updated_at'] or '',
    m['available_at'] or '',
    m['last_error'] or ''
  }
end

if redis.call('EXISTS', rec) == 0 then
  return {'missing'}
end

local m = hgetall_map(rec)
if (m['status'] or '') == 'claimed' then
  local exp = tonumber(m['lease_expires_ms'] or '0') or 0
  if exp <= nowMs then
    -- WEBHOOKS-1: restore unfinished claim attempt so crash reclaim does not
    -- burn maxAttempts handler budget (parity with memory soft-release).
    local logicalKey = m['key'] or ''
    local attempts = tonumber(m['attempts'] or '0') or 0
    if attempts > 0 then
      attempts = attempts - 1
    end
    redis.call('HSET', rec,
      'status', 'pending',
      'lease_owner', '',
      'lease_token', '',
      'lease_expires_at', '',
      'lease_expires_ms', '0',
      'attempts', tostring(attempts),
      'available_at', nowIso,
      'available_ms', tostring(nowMs),
      'updated_at', nowIso
    )
    if logicalKey ~= '' then
      redis.call('ZADD', idx, nowMs, logicalKey)
    end
    m = hgetall_map(rec)
  end
end

local p = pack(m)
return {'ok', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
`.trim();

/** KEYS[1]=record KEYS[2]=retryIndex ARGV: beforeIso, beforeMs, logicalKey — delete terminal */
export const WEBHOOK_DELETE_IF_EXPIRED_LUA = `
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
if status == 'completed' or status == 'dead_letter' then
  redis.call('DEL', rec)
  redis.call('ZREM', idx, logicalKey)
  return {'deleted'}
end
return {'skipped'}
`.trim();
