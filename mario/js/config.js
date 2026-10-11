// Every tuning number for the game lives here.
export const TILE = 48;            // world pixels per map tile
export const VIEW_W = 960;         // logical canvas size (scaled to fit the window)
export const VIEW_H = 540;

export const PHYS = {
  gravity: 2400,       // px/s²
  maxFall: 900,        // px/s terminal velocity
  walkMax: 230,        // px/s
  runMax: 360,         // px/s while holding run
  groundAccel: 2000,   // px/s²
  airAccel: 1300,
  friction: 2200,      // deceleration when no direction is held (ground)
  airFriction: 600,
  jumpV: 880,          // initial jump velocity (≈ 3.4 tiles high)
  jumpCut: 0.45,       // fraction of jumpV kept when jump is released early
  stompV: 430,         // bounce after stomping an enemy
  coyoteTime: 0.1,     // s after leaving a ledge you can still jump
  jumpBuffer: 0.12,    // s a jump press is remembered before landing
};

export const RULES = {
  startLives: 3,
  coinsPerLife: 100,
  invulnTime: 1.6,     // s of invulnerability after being hit as big Hero
  deathHop: 620,       // initial upward speed on death
  deathTime: 2.2,      // s before the death screen
  clearDelay: 1.4,     // s after reaching the flag
  bumpTime: 0.12,
};

export const SCORE = {
  coin: 100,
  stomp: 100,
  powerup: 1000,
  brick: 50,
  flagBase: 500,
  timePerSecond: 10,   // bonus for seconds left on the clock
};
