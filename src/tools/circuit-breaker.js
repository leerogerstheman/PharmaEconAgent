/**
 * 熔断器（CircuitBreaker）
 * 移植自 HelloAgents 框架 tools/circuit_breaker.py
 *
 * 连续失败达到阈值后短路，快速失败，避免每次请求都卡在网络超时上。
 * 对"不太会用电脑"的用户尤其重要：不能让界面一直转圈。
 */

const STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

class CircuitBreaker {
  /**
   * @param {object} opts
   * @param {number} opts.failureThreshold  连续失败多少次后打开  默认 3
   * @param {number} opts.resetTimeoutMs   打开后多久进入半开    默认 30000
   * @param {number} opts.successThreshold  半开态下成功几次后关闭 默认 1
   */
  constructor(opts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30000;
    this.successThreshold = opts.successThreshold ?? 1;
    this.reset();
  }

  reset() {
    this.state = STATES.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
    this.lastError = null;
  }

  /** @returns {{allowed: boolean, reason?: string, retryAfterMs?: number}} */
  check() {
    if (this.state === STATES.OPEN) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = STATES.HALF_OPEN;
        this.successes = 0;
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `模型服务连续失败已暂停调用（${this.lastError || '未知错误'}），将在 ${Math.ceil(
          (this.resetTimeoutMs - elapsed) / 1000
        )} 秒后自动重试。`,
        retryAfterMs: this.resetTimeoutMs - elapsed,
      };
    }
    return { allowed: true };
  }

  onSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      this.successes += 1;
      if (this.successes >= this.successThreshold) {
        this.state = STATES.CLOSED;
        this.failures = 0;
        this.successes = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  onFailure(err) {
    this.lastError = err && err.message ? err.message : String(err);
    if (this.state === STATES.HALF_OPEN) {
      this.state = STATES.OPEN;
      this.openedAt = Date.now();
      this.failures = this.failureThreshold;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = STATES.OPEN;
      this.openedAt = Date.now();
    }
  }

  get snapshot() {
    return {
      state: this.state,
      failures: this.failures,
      lastError: this.lastError,
    };
  }
}

module.exports = { CircuitBreaker, STATES };
