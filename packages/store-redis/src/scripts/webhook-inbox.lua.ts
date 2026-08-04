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
  redis.call('ZREM', idx, logicalKey)
  local m = hgetall_map(rec)
  local p = pack(m)
  return {'acquired', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13], leaseToken}
end

local m = hgetall_map(rec)
local status = m['status'] or ''
local ph = m['payload_hash'] or ''

if ph ~= payloadHash then
  local p = pack(m)
  return {'payload_hash_conflict', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
end

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
    local p = pack(m)
    return {'in_progress', p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12], p[13]}
  end
end

-- pending or expired claim → re-claim
local gen = (tonumber(m['generation'] or '0') or 0) + 1
local attempts = (tonumber(m['attempts'] or '0') or 0) + 1
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
redis.call('ZREM', idx, logicalKey)
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

/** KEYS[1]=record KEYS[2]=retryIndex ARGV: nowMs, nowIso, leaseToken, logicalKey, retentionTtlSec */
export const WEBHOOK_COMPLETE_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local nowMs = tonumber(ARGV[1])
local nowIso = ARGV[2]
local leaseToken = ARGV[3]
local logicalKey = ARGV[4]
local retentionTtlSec = tonumber(ARGV[5]) or 0

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
if retentionTtlSec > 0 then
  redis.call('EXPIRE', rec, retentionTtlSec)
end
return {'ok'}
`.trim();

/**
 * KEYS[1]=record KEYS[2]=retryIndex
 * ARGV: nowMs, nowIso, leaseToken, error, deadLetter(0|1), availableAt, availableMs, logicalKey, retentionTtlSec
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
local retentionTtlSec = tonumber(ARGV[9]) or 0

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

local status = 'pending'
if dead == '1' then
  status = 'dead_letter'
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
  'updated_at', nowIso
)

if status == 'pending' then
  redis.call('ZADD', idx, tonumber(availableMs), logicalKey)
else
  redis.call('ZREM', idx, logicalKey)
  if retentionTtlSec > 0 then
    redis.call('EXPIRE', rec, retentionTtlSec)
  end
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
    local logicalKey = m['key'] or ''
    redis.call('HSET', rec,
      'status', 'pending',
      'lease_owner', '',
      'lease_token', '',
      'lease_expires_at', '',
      'lease_expires_ms', '0',
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

/** KEYS[1]=record KEYS[2]=retryIndex ARGV: beforeIso, logicalKey — delete terminal */
export const WEBHOOK_DELETE_IF_EXPIRED_LUA = `
local rec = KEYS[1]
local idx = KEYS[2]
local beforeIso = ARGV[1]
local logicalKey = ARGV[2]

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
local updated = m['updated_at'] or ''
if updated > beforeIso then
  return {'skipped'}
end
if status == 'completed' or status == 'dead_letter' then
  redis.call('DEL', rec)
  redis.call('ZREM', idx, logicalKey)
  return {'deleted'}
end
return {'skipped'}
`.trim();
