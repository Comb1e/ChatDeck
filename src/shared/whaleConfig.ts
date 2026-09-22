/**
 * 鲸鱼形态(悬浮窗压缩态)配置——逐值移植自 whale-pet 项目 config.json。
 * 渲染层(行为/物理/动画)与主进程(光标轮询间隔)共用同一份,保持类型安全。
 */
export interface WhaleConfig {
  whale: {
    scale: number
    swimSpeed: number
    floorInset: number
    swayRatio: number
  }
  swim: {
    sideInset: number
    topInset: number
    bottomInset: number
    minDistance: number
    maxDistance: number
    continueChance: number
    curveBend: number
    speedMin: number
    speedMax: number
    tiltLimit: number
    pathSamples: number
  }
  behavior: {
    minDelay: number
    maxDelay: number
    weights: Record<string, number>
    sleepDurationMin: number
    sleepDurationMax: number
    minTeleportInterval: number
  }
  jumpDive: {
    crouchMs: number
    crouchBack: number
    jumpMs: number
    jumpHeight: number
    arcForwardMin: number
    arcForwardMax: number
    submergeMs: number
    riseMs: number
    emergeDepth: number
    emergeSquashY: number
    emergeSquashX: number
    waitMin: number
    waitMax: number
    targetMargin: number
    minTravel: number
  }
  particles: {
    splashCount: number
    surfaceCount: number
  }
  gaze: {
    pupilRange: number
    tiltRange: number
  }
  performance: {
    whaleHalf: number
    fxMarginX: number
    fxMarginY: number
    originStep: number
    cursorPollMs: number
    idleFps: number
    sleepFps: number
    particlePoolLimit: number
    particleEdgeFade: number
    maxPhysicsDeltaMs: number
  }
  motion: {
    gravity: number
    bounceThreshold: number
    groundRestitution: number
    horizontalRestitution: number
    edgeRestitution: number
    edgeInset: number
    maxThrowVelocity: number
    throwXScale: number
    throwYScale: number
  }
  interaction: {
    dragThreshold: number
    clickDistance: number
    clickMs: number
    referenceHz: number
    maxCatchUpSteps: number
    frequencyHz: number
    dampingRatio: number
  }
  animation: {
    bodyFrequencyHz: number
    bodyDampingRatio: number
    tailBlendMs: number
    gazeFrequencyHz: number
    deformLimit: number
    tiltLimit: number
    velocityTilt: number
    velocityStretch: number
    bobAmplitude: number
    bobFrequencyHz: number
    breathAmplitude: number
    breathFrequencyHz: number
    settlePosition: number
    settleVelocity: number
    transitionMs: number
    turnMs: number
    swimRampMs: number
    swimHeight: number
    impactSpeed: number
    impactCompressMs: number
    impactReboundMs: number
    impactSettleMs: number
    happyAnticipateMs: number
    happyHopMs: number
    happyHeight: number
    tail: Record<string, [number, number]>
  }
}

export const WHALE_CONFIG: WhaleConfig = {
  whale: {
    scale: 1.0,
    swimSpeed: 95,
    floorInset: 6,
    swayRatio: 0.2
  },
  swim: {
    sideInset: 160,
    topInset: 205,
    bottomInset: 45,
    minDistance: 180,
    maxDistance: 720,
    continueChance: 0.6,
    curveBend: 150,
    speedMin: 0.8,
    speedMax: 1.25,
    tiltLimit: 12,
    pathSamples: 48
  },
  behavior: {
    minDelay: 1200,
    maxDelay: 4200,
    weights: { idle: 26, swim: 30, jumpDive: 14, spin: 10, sleep: 20 },
    sleepDurationMin: 6000,
    sleepDurationMax: 14000,
    minTeleportInterval: 8000
  },
  jumpDive: {
    crouchMs: 320,
    crouchBack: 18,
    jumpMs: 720,
    jumpHeight: 190,
    arcForwardMin: 140,
    arcForwardMax: 260,
    submergeMs: 240,
    riseMs: 520,
    emergeDepth: 120,
    emergeSquashY: 0.62,
    emergeSquashX: 0.74,
    waitMin: 500,
    waitMax: 1800,
    targetMargin: 100,
    minTravel: 160
  },
  particles: {
    splashCount: 22,
    surfaceCount: 16
  },
  gaze: {
    pupilRange: 2.8,
    tiltRange: 4
  },
  performance: {
    whaleHalf: 135,
    fxMarginX: 280,
    fxMarginY: 250,
    originStep: 24,
    cursorPollMs: 33,
    idleFps: 30,
    sleepFps: 30,
    particlePoolLimit: 128,
    particleEdgeFade: 30,
    maxPhysicsDeltaMs: 133.3333333333
  },
  motion: {
    gravity: 2400,
    bounceThreshold: 450,
    groundRestitution: 0.42,
    horizontalRestitution: 0.65,
    edgeRestitution: 0.5,
    edgeInset: 60,
    maxThrowVelocity: 900,
    throwXScale: 0.7,
    throwYScale: 0.5
  },
  interaction: {
    dragThreshold: 8,
    clickDistance: 10,
    clickMs: 350,
    referenceHz: 60,
    maxCatchUpSteps: 8,
    frequencyHz: 10,
    dampingRatio: 1
  },
  animation: {
    bodyFrequencyHz: 5,
    bodyDampingRatio: 0.65,
    tailBlendMs: 120,
    gazeFrequencyHz: 7,
    deformLimit: 0.14,
    tiltLimit: 18,
    velocityTilt: 0.018,
    velocityStretch: 0.00011,
    bobAmplitude: 3,
    bobFrequencyHz: 0.4,
    breathAmplitude: 0.012,
    breathFrequencyHz: 0.55,
    settlePosition: 0.001,
    settleVelocity: 0.01,
    transitionMs: 180,
    turnMs: 160,
    swimRampMs: 240,
    swimHeight: 26,
    impactSpeed: 1000,
    impactCompressMs: 75,
    impactReboundMs: 110,
    impactSettleMs: 220,
    happyAnticipateMs: 90,
    happyHopMs: 280,
    happyHeight: 28,
    tail: {
      idle: [9, 1.6],
      swim: [18, 3.4],
      held: [8, 1.8],
      dragged: [20, 4.2],
      falling: [12, 2.4],
      sleep: [3, 0.8],
      happy: [24, 5]
    }
  }
}
