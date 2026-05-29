import { useEffect, useRef, useState, useCallback } from "react";
import "./DotBall.css";

const SPECTRUM = [
{ name: "Red", color: "#FF2020", shadow: "rgba(255,32,32,0.85)" },
{ name: "Orange", color: "#FF8000", shadow: "rgba(255,128,0,0.85)" },
{ name: "Yellow", color: "#FFE600", shadow: "rgba(255,230,0,0.85)" },
{ name: "Green", color: "#00FF6A", shadow: "rgba(0,255,106,0.85)" },
{ name: "Blue", color: "#1A8FFF", shadow: "rgba(26,143,255,0.85)" },
{ name: "Indigo", color: "#4B0082", shadow: "rgba(75,0,130,0.85)" },
{ name: "Violet", color: "#BF00FF", shadow: "rgba(191,0,255,0.85)" },
];

const BALL_R = 14;
const PADDLE_H = 10;
const PADDLE_W_PCT = 0.22;
const PADDLE_Y_OFF = 28;
const INITIAL_SPEED = 4.2;
const PERFECT_ZONE = 0.3;
const PERFECT_CHAIN_MAX = 7;
const PERFECT_SPECTRUM_BONUS = 10;
const FLOW_CYCLE_BONUS = 3;
const EVENT_MSG_DURATION = 1200;
const MAX_BALLS = 3;
const TRAIL_CAP = 5;

const PADDLE_FORGIVENESS_PX = BALL_R * 0.4;
const MIN_VELOCITY_FOR_FORGIVENESS = 3;
const CALM_PHASE_MS = 2500;
const LEADERBOARD_KEY = "dotball_leaderboard_v1";

const PERFORMANCE = {
HIGH: { maxTrails: 5 },
MEDIUM: { maxTrails: 4 },
LOW: { maxTrails: 3 },
MINIMAL: { maxTrails: 2 },
};

const QUALITY_ORDER = ["HIGH", "MEDIUM", "LOW", "MINIMAL"];
const TRAIL_INTERVAL = { 0: 3, 1: 1, 2: 2 };

function sanitizeName(raw) {
return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 12);
}

function randomAngle(multiplier = 1) {
const angle = (Math.random() * 60 + 30) * (Math.PI / 180);
const dir = Math.random() < 0.5 ? 1 : -1;
return {
vx: Math.cos(angle) * dir * INITIAL_SPEED * multiplier,
vy: Math.sin(angle) * INITIAL_SPEED * multiplier,
};
}

function loadLeaderboard() {
try {
const raw = localStorage.getItem(LEADERBOARD_KEY);
const parsed = raw ? JSON.parse(raw) : [];
return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
} catch {
return [];
}
}

function saveLeaderboard(entries) {
try {
localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, 10)));
} catch { /* unavailable */ }
}

function createAudio() {
let ctx = null;
let musicGain = null;
let musicOsc = null;
let pulseOsc = null;
let pulseGain = null;

const getCtx = () => {
if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
return ctx;
};

const ensureMusic = () => {
const c = getCtx();
if (!musicGain) {
musicGain = c.createGain();
musicGain.gain.value = 0;
musicGain.connect(c.destination);
}
if (!musicOsc) {
musicOsc = c.createOscillator();
musicOsc.type = "triangle";
musicOsc.frequency.value = 90;
musicOsc.connect(musicGain);
musicOsc.start();
}
if (!pulseGain) {
pulseGain = c.createGain();
pulseGain.gain.value = 0;
pulseGain.connect(c.destination);
}
if (!pulseOsc) {
pulseOsc = c.createOscillator();
pulseOsc.type = "sine";
pulseOsc.frequency.value = 0.15;
pulseOsc.connect(pulseGain);
pulseOsc.start();
}
};

const playTone = (freq, type, gainVal, duration, startTime = 0) => {
const c = getCtx();
const osc = c.createOscillator();
const g = c.createGain();
osc.connect(g);
g.connect(c.destination);
osc.type = type;
osc.frequency.setValueAtTime(freq, c.currentTime + startTime);
g.gain.setValueAtTime(gainVal, c.currentTime + startTime);
g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + startTime + duration);
osc.start(c.currentTime + startTime);
osc.stop(c.currentTime + startTime + duration + 0.05);
};

return {
unlock() {
if (ctx?.state === "suspended") ctx.resume();
},
start() {
ensureMusic();
musicGain.gain.cancelScheduledValues(getCtx().currentTime);
musicGain.gain.linearRampToValueAtTime(0.035, getCtx().currentTime + 1.5);
pulseGain.gain.cancelScheduledValues(getCtx().currentTime);
pulseGain.gain.linearRampToValueAtTime(0.012, getCtx().currentTime + 1.5);
playTone(220, "sine", 0.18, 0.12);
playTone(330, "sine", 0.12, 0.10, 0.08);
playTone(440, "triangle", 0.10, 0.18, 0.15);
},
updateIntensity(chain, flow, balls, calmFactor = 1) {
if (!musicOsc || !musicGain) return;
const c = getCtx();
const base = 90 + chain * 3 + flow * 2 + balls * 8;
const gain = Math.min(0.03 + chain * 0.003 + balls * 0.006, 0.08);
musicOsc.frequency.linearRampToValueAtTime(Math.min(base, 180), c.currentTime + 0.18);
musicGain.gain.linearRampToValueAtTime(gain * calmFactor, c.currentTime + 0.22);
},
stopMusic() {
if (!musicGain) return;
const c = getCtx();
musicGain.gain.cancelScheduledValues(c.currentTime);
musicGain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6);
pulseGain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.6);
},
pauseMusic() {
if (!musicGain) return;
musicGain.gain.linearRampToValueAtTime(0.008, getCtx().currentTime + 0.15);
},
resumeMusic(chain, flow, balls) {
this.updateIntensity(chain, flow, balls);
},
normalHit(colorIdx) { playTone(200 + colorIdx * 40, "triangle", 0.14, 0.08); },
perfectHit(colorIdx) {
const freq = 320 + colorIdx * 55;
playTone(freq, "sine", 0.18, 0.10);
playTone(freq * 1.5, "triangle", 0.10, 0.08, 0.05);
},
chainSnap() {
const c = getCtx();
const osc = c.createOscillator();
const g = c.createGain();
osc.connect(g);
g.connect(c.destination);
osc.type = "sawtooth";
osc.frequency.setValueAtTime(280, c.currentTime);
osc.frequency.exponentialRampToValueAtTime(90, c.currentTime + 0.18);
g.gain.setValueAtTime(0.16, c.currentTime);
g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22);
osc.start(c.currentTime);
osc.stop(c.currentTime + 0.25);
},
flowCycle(cycleNum) {
const base = 330 + (cycleNum % 4) * 30;
playTone(base, "sine", 0.14, 0.14);
playTone(base * 1.25, "sine", 0.10, 0.12, 0.10);
},
perfectSpectrum() {
[330, 440, 550, 660].forEach((f, i) => playTone(f, "sine", 0.16, 0.18, i * 0.10));
},
submitScore() {
playTone(440, "sine", 0.12, 0.12);
playTone(660, "triangle", 0.10, 0.16, 0.08);
},
pause() { playTone(200, "sine", 0.10, 0.10); },
resume() { playTone(300, "sine", 0.10, 0.10); },
fail() {
this.stopMusic();
const c = getCtx();
const osc = c.createOscillator();
const g = c.createGain();
osc.connect(g);
g.connect(c.destination);
osc.type = "sawtooth";
osc.frequency.setValueAtTime(220, c.currentTime);
osc.frequency.exponentialRampToValueAtTime(60, c.currentTime + 0.5);
g.gain.setValueAtTime(0.20, c.currentTime);
g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.55);
osc.start(c.currentTime);
osc.stop(c.currentTime + 0.6);
},
};
}

const haptic = {
normal() { navigator.vibrate?.(18); },
perfect() { navigator.vibrate?.([12, 8, 12]); },
snap() { navigator.vibrate?.(30); },
spectrum() { navigator.vibrate?.([20, 10, 20, 10, 40]); },
fail() { navigator.vibrate?.(60); },
};

export default function DotBall() {
const [score, setScore] = useState(0);
const [phase, setPhase] = useState("idle");
const [colorIdx, setColorIdx] = useState(0);
const [perfectChain, setPerfectChain] = useState(0);
const [flowCycles, setFlowCycles] = useState(0);
const [eventMsg, setEventMsg] = useState(null);
const [arenaClass, setArenaClass] = useState("");
const [isPaused, setIsPaused] = useState(false);
const [ballCount, setBallCount] = useState(1);
const [leaderboard, setLeaderboard] = useState(() => loadLeaderboard());
const [playerName, setPlayerName] = useState("");
const [scoreSubmitted, setScoreSubmitted] = useState(false);
const [newEntryIdx, setNewEntryIdx] = useState(null);

const arenaRef = useRef(null);
const paddleRef = useRef(null);
const ballRefs = useRef([]);
const trailRefs = useRef([]);

const mountedRef = useRef(true);
const audioRef = useRef(null);
const tickRef = useRef(null);
const msgTimerRef = useRef(null);
const replayRef = useRef({ inputs: [], frames: [] });

const performanceRef = useRef({
stressMs: 0, stableMs: 0, lastFrame: 0, tier: "HIGH",
});

const gs = useRef({
balls: [],
paddleX: 0,
arenaW: 0, arenaH: 0, paddleW: 0,
colorIdx: 0,
score: 0,
perfectChain: 0, bestChain: 0,
flowCycles: 0,
spectralHits: 0,
perfectSpectrumCount: 0,
maxBallsReached: 1,
calmPhaseEndTime: 0,
alive: false, paused: false,
rafId: null, lastTime: null,
frame: 0,
_chainSnapFired: false,
});

const getAudio = useCallback(() => {
if (!audioRef.current) audioRef.current = createAudio();
return audioRef.current;
}, []);

const isInCalmPhase = useCallback(() => {
return gs.current.calmPhaseEndTime > performance.now();
}, []);

const startCalmPhase = useCallback(() => {
gs.current.calmPhaseEndTime = performance.now() + CALM_PHASE_MS;
}, []);

const showMsg = useCallback((msg, duration = EVENT_MSG_DURATION) => {
if (!mountedRef.current) return;
if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
setEventMsg(msg);
msgTimerRef.current = setTimeout(() => {
if (mountedRef.current) setEventMsg(null);
}, duration);
}, []);

const pulseArena = useCallback((cls, duration = 600) => {
if (!mountedRef.current) return;
setArenaClass(cls);
setTimeout(() => {
if (mountedRef.current) setArenaClass("");
}, duration);
}, []);

const applyBallColor = useCallback((idx, ballEl) => {
if (!ballEl) return;
const { color, shadow } = SPECTRUM[idx];
ballEl.style.background = color;
ballEl.style.boxShadow = `0 0 18px 6px ${shadow}, 0 0 40px 10px ${shadow}`;
}, []);

const trimAllTrailsToTier = useCallback((tier) => {
const maxTrails = PERFORMANCE[tier].maxTrails;
for (const ball of gs.current.balls) {
if (ball.trails && ball.trails.length > maxTrails) {
ball.trails = ball.trails.slice(0, maxTrails);
}
}
}, []);

const updatePerformance = useCallback((timestamp) => {
const perf = performanceRef.current;
if (!perf.lastFrame) { perf.lastFrame = timestamp; return; }
const delta = timestamp - perf.lastFrame;
perf.lastFrame = timestamp;
if (delta > 18) {
perf.stressMs += delta;
perf.stableMs = 0;
} else if (delta < 16.8) {
perf.stableMs += delta;
perf.stressMs = Math.max(0, perf.stressMs - delta);
} else {
perf.stressMs = Math.max(0, perf.stressMs - delta * 0.5);
perf.stableMs = Math.max(0, perf.stableMs - delta * 0.5);
}
const currentIndex = QUALITY_ORDER.indexOf(perf.tier);
if (perf.stressMs > 100 && currentIndex < QUALITY_ORDER.length - 1) {
perf.tier = QUALITY_ORDER[currentIndex + 1];
perf.stressMs = 0;
perf.stableMs = 0;
trimAllTrailsToTier(perf.tier);
}
if (perf.stableMs > 500 && currentIndex > 0) {
perf.tier = QUALITY_ORDER[currentIndex - 1];
perf.stressMs = 0;
perf.stableMs = 0;
}
}, [trimAllTrailsToTier]);

const recordTrail = useCallback((ball) => {
const maxTrails = PERFORMANCE[performanceRef.current.tier].maxTrails;
if (!ball.trails) ball.trails = [];
ball.trails.unshift({ x: ball.x, y: ball.y, colorIdx: ball.colorIdx });
if (ball.trails.length > maxTrails) {
ball.trails = ball.trails.slice(0, maxTrails);
}
}, []);

const renderTrails = useCallback((balls) => {
const calmOpacity = isInCalmPhase() ? 0.72 : 1;
const maxTrails = PERFORMANCE[performanceRef.current.tier].maxTrails;
for (let ballIndex = 0; ballIndex < MAX_BALLS; ballIndex++) {
const ball = balls[ballIndex];
const trailBucket = trailRefs.current[ballIndex] || [];
for (let t = 0; t < TRAIL_CAP; t++) {
const node = trailBucket[t];
if (!node) continue;
if (!ball || !ball.trails || !ball.trails[t] || t >= maxTrails) {
node.style.opacity = 0;
continue;
}
const trail = ball.trails[t];
const spectrum = SPECTRUM[trail.colorIdx];
const opacity = 0.35 * Math.pow(0.6, t) * calmOpacity;
node.style.opacity = opacity;
node.style.background = spectrum.color;
node.style.transform =
`translate3d(${trail.x - BALL_R}px, ${trail.y - BALL_R}px, 0) scale(${1 - t * 0.08})`;
}
}
}, [isInCalmPhase]);

const spawnBall = useCallback((baseBall, multiplier, colorOffset) => {
const angle = randomAngle(multiplier);
return {
id: 0,
x: baseBall.x, y: baseBall.y,
vx: angle.vx, vy: angle.vy,
prevX: baseBall.x, prevY: baseBall.y,
colorIdx: (baseBall.colorIdx + colorOffset) % SPECTRUM.length,
wobblePhase: Math.random() * Math.PI * 2,
trails: [],
};
}, []);

const processHit = useCallback((g, ball, hitOffset, isForgiven = false) => {
const isPerfect = !isForgiven && Math.abs(hitOffset) < PERFECT_ZONE;
const nextColorIdx = (ball.colorIdx + 1) % SPECTRUM.length;
ball.colorIdx = nextColorIdx;

const ballEl = ballRefs.current[ball.id];
if (ballEl) applyBallColor(nextColorIdx, ballEl);

g.spectralHits += 1;
let flowCycleTriggered = false;
if (g.spectralHits >= SPECTRUM.length) {
g.spectralHits = 0;
g.flowCycles += 1;
g.score += FLOW_CYCLE_BONUS;
flowCycleTriggered = true;
}

let perfectSpectrumTriggered = false;

if (isPerfect) {
g.score += 2;
g.perfectChain += 1;
g.bestChain = Math.max(g.bestChain, g.perfectChain);
getAudio().perfectHit(nextColorIdx);
haptic.perfect();

if (g.perfectChain >= PERFECT_CHAIN_MAX) {
g.perfectSpectrumCount += 1;
g.score += PERFECT_SPECTRUM_BONUS;
g.perfectChain = 0;
perfectSpectrumTriggered = true;
getAudio().perfectSpectrum();
haptic.spectrum();

if (g.balls.length < MAX_BALLS && !isInCalmPhase()) {
const multiplier = g.balls.length === 1 ? 1.15 : 1.32;
const newBall = spawnBall(ball, multiplier, 3);
newBall.id = g.balls.length;
g.balls.push(newBall);
g.maxBallsReached = Math.max(g.maxBallsReached, g.balls.length);
setBallCount(g.balls.length);
}

if (g.balls.length >= MAX_BALLS) startCalmPhase();
}
} else {
const hadChain = g.perfectChain > 0;
g.score += 1;
g.perfectChain = 0;
getAudio().normalHit(nextColorIdx);
haptic.normal();
if (hadChain && !isForgiven) {
getAudio().chainSnap();
haptic.snap();
g._chainSnapFired = true;
}
}

const calmFactor = isInCalmPhase() ? 0.6 : 1;
getAudio().updateIntensity(g.perfectChain, g.flowCycles, g.balls.length, calmFactor);

setScore(g.score);
setColorIdx(nextColorIdx);
setPerfectChain(g.perfectChain);

if (flowCycleTriggered) {
setFlowCycles(g.flowCycles);
getAudio().flowCycle(g.flowCycles);
pulseArena("db-arena--cycle-pulse");
showMsg(`CYCLE ${g.flowCycles}`);
}

if (perfectSpectrumTriggered) {
pulseArena("db-arena--spectrum-pulse", 1000);
showMsg("PERFECT SPECTRUM", 1800);
} else if (isPerfect && !flowCycleTriggered) {
showMsg(`PERFECT ×${g.perfectChain === 0 ? PERFECT_CHAIN_MAX : g.perfectChain}`);
}

if (g._chainSnapFired) {
g._chainSnapFired = false;
pulseArena("db-arena--snap-pulse");
showMsg("CHAIN SNAP");
}
}, [applyBallColor, getAudio, isInCalmPhase, pulseArena, showMsg, spawnBall, startCalmPhase]);

const resolveCollisionCandidate = useCallback((g, paddleLeft, paddleRight) => {
const candidates = [];
const paddleTop = g.arenaH - PADDLE_Y_OFF - PADDLE_H;
for (let i = 0; i < g.balls.length; i++) {
const ball = g.balls[i];
const ballBottom = ball.y + BALL_R;
const inYRange =
ball.vy > 0 &&
ballBottom >= paddleTop &&
ballBottom <= paddleTop + PADDLE_H + Math.abs(ball.vy) + 2;
if (!inYRange) continue;
const standard = ball.x >= paddleLeft && ball.x <= paddleRight;
const wasInside = ball.prevX >= paddleLeft && ball.prevX <= paddleRight;
const nowOutside= ball.x < paddleLeft || ball.x > paddleRight;
const nearLeft = ball.x < paddleLeft && ball.x >= paddleLeft - PADDLE_FORGIVENESS_PX;
const nearRight = ball.x > paddleRight && ball.x <= paddleRight + PADDLE_FORGIVENESS_PX;
const fastEnough= Math.abs(ball.vx) >= MIN_VELOCITY_FOR_FORGIVENESS;
const forgiven = !standard && wasInside && nowOutside && fastEnough && (nearLeft || nearRight);
if (standard || forgiven) {
candidates.push({ index: i, forgiven, distance: Math.abs(ball.x - g.paddleX) });
}
}
if (!candidates.length) return null;
candidates.sort((a, b) => a.distance - b.distance);
return candidates.find((c) => !c.forgiven) || candidates[0];
}, []);

const finalizeRun = useCallback(() => {
const g = gs.current;
g.alive = false;
getAudio().fail();
haptic.fail();
setScore(g.score);
setFlowCycles(g.flowCycles);
setBallCount(g.balls.length);
setScoreSubmitted(false);
setNewEntryIdx(null);
setPhase("dead");
}, [getAudio]);

const tick = useCallback((timestamp) => {
const g = gs.current;
if (!g.alive || g.paused) return;

updatePerformance(timestamp);
g.frame += 1;

const dt = g.lastTime
? Math.min((timestamp - g.lastTime) / 16.667, 3)
: 1;
g.lastTime = timestamp;

replayRef.current.frames.push({
frame: g.frame, paddleX: g.paddleX, ballCount: g.balls.length,
});

const paddleTop = g.arenaH - PADDLE_Y_OFF - PADDLE_H;
const paddleLeft = g.paddleX - g.paddleW / 2;
const paddleRight = g.paddleX + g.paddleW / 2;

for (let i = 0; i < g.balls.length; i++) {
const ball = g.balls[i];
ball.prevX = ball.x;
ball.prevY = ball.y;
if (g.frame % (TRAIL_INTERVAL[ball.id] || 2) === 0) recordTrail(ball);
if (ball.id === 2) {
ball.wobblePhase += 0.05 * dt;
ball.x += Math.sin(ball.wobblePhase) * 1.0;
}
ball.x += ball.vx * dt;
ball.y += ball.vy * dt;
if (ball.x - BALL_R <= 0) {
ball.x = BALL_R;
ball.vx = Math.abs(ball.vx);
} else if (ball.x + BALL_R >= g.arenaW) {
ball.x = g.arenaW - BALL_R;
ball.vx = -Math.abs(ball.vx);
}
if (ball.y - BALL_R <= 0) {
ball.y = BALL_R;
ball.vy = Math.abs(ball.vy);
}
}

const collision = resolveCollisionCandidate(g, paddleLeft, paddleRight);
if (collision) {
const ball = g.balls[collision.index];
ball.y = paddleTop - BALL_R;
ball.vy = -Math.abs(ball.vy);
if (collision.forgiven) {
ball.x = ball.x < paddleLeft ? paddleLeft : paddleRight;
}
const hitOffset = (ball.x - g.paddleX) / (g.paddleW / 2);
const angleStrength = ball.id === 2 ? 1.8 : ball.id === 1 ? 1.45 : 1.2;
ball.vx += hitOffset * (collision.forgiven ? 0.6 : angleStrength);
if (ball.id === 2 && !collision.forgiven) {
ball.vx *= 1.01;
ball.vy *= 1.01;
}
const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
const cap = INITIAL_SPEED * (ball.id === 2 ? 3.0 : ball.id === 1 ? 2.6 : 2.2);
if (speed > cap) {
ball.vx = (ball.vx / speed) * cap;
ball.vy = (ball.vy / speed) * cap;
}
processHit(g, ball, hitOffset, collision.forgiven);
}

for (let i = 0; i < g.balls.length; i++) {
const ball = g.balls[i];
if (ball.y - BALL_R > g.arenaH) { finalizeRun(); return; }
const ballEl = ballRefs.current[i];
if (ballEl) {
ballEl.style.transform =
`translate3d(${ball.x - BALL_R}px, ${ball.y - BALL_R}px, 0)`;
}
}

renderTrails(g.balls);

if (paddleRef.current) {
paddleRef.current.style.transform =
`translate3d(${g.paddleX - g.paddleW / 2}px, 0, 0)`;
}

const calmFactor = isInCalmPhase() ? 0.6 : 1;
getAudio().updateIntensity(g.perfectChain, g.flowCycles, g.balls.length, calmFactor);

g.rafId = requestAnimationFrame(tickRef.current);
}, [finalizeRun, getAudio, isInCalmPhase, processHit, recordTrail, renderTrails, resolveCollisionCandidate, updatePerformance]);

useEffect(() => { tickRef.current = tick; }, [tick]);

const startGame = useCallback(() => {
const arena = arenaRef.current;
if (!arena) return;

getAudio().unlock();
getAudio().start();

const rect = arena.getBoundingClientRect();
const arenaW = rect.width;
const arenaH = rect.height;
const paddleW = arenaW * PADDLE_W_PCT;
const g = gs.current;

g.arenaW = arenaW;
g.arenaH = arenaH;
g.paddleW = paddleW;
g.paddleX = arenaW / 2;
g.colorIdx = 0;
g.score = 0;
g.perfectChain = 0;
g.bestChain = 0;
g.flowCycles = 0;
g.spectralHits = 0;
g.perfectSpectrumCount = 0;
g.maxBallsReached = 1;
g.calmPhaseEndTime = 0;
g.alive = true;
g.paused = false;
g.lastTime = null;
g.frame = 0;
g._chainSnapFired = false;

const angle = randomAngle();
g.balls = [{
id: 0,
x: arenaW / 2, y: arenaH * 0.35,
vx: angle.vx, vy: angle.vy,
prevX: arenaW / 2, prevY: arenaH * 0.35,
colorIdx: 0,
wobblePhase: 0,
trails: [],
}];

replayRef.current.frames = [];
replayRef.current.inputs = [];
performanceRef.current = { stressMs: 0, stableMs: 0, lastFrame: 0, tier: "HIGH" };

setBallCount(1);
setScore(0);
setColorIdx(0);
setPerfectChain(0);
setFlowCycles(0);
setEventMsg(null);
setArenaClass("");
setIsPaused(false);
setPlayerName("");
setScoreSubmitted(false);
setNewEntryIdx(null);
setPhase("playing");

applyBallColor(0, ballRefs.current[0]);

if (paddleRef.current) {
paddleRef.current.style.width = `${paddleW}px`;
paddleRef.current.style.transform =
`translate3d(${arenaW / 2 - paddleW / 2}px, 0, 0)`;
}

if (g.rafId) cancelAnimationFrame(g.rafId);
g.rafId = requestAnimationFrame(tickRef.current);
}, [applyBallColor, getAudio]);

const submitScore = useCallback(() => {
if (scoreSubmitted) return;
const g = gs.current;
const name = sanitizeName(playerName).trim() || "PLAYER";
const entry = {
name,
score: g.score,
flowCycles: g.flowCycles,
perfectSpectrums: g.perfectSpectrumCount,
maxBalls: g.maxBallsReached,
bestChain: g.bestChain,
date: new Date().toISOString(),
};
const next = [...leaderboard, entry]
.sort((a, b) => b.score - a.score)
.slice(0, 10);
const idx = next.findIndex(
(e) => e.date === entry.date && e.name === entry.name
);
saveLeaderboard(next);
setLeaderboard(next);
setNewEntryIdx(idx);
setScoreSubmitted(true);
getAudio().submitScore();
}, [getAudio, leaderboard, playerName, scoreSubmitted]);

const resetLeaderboard = useCallback(() => {
saveLeaderboard([]);
setLeaderboard([]);
setNewEntryIdx(null);
}, []);

const togglePause = useCallback(() => {
const g = gs.current;
if (!g.alive) return;
if (g.paused) {
g.paused = false;
g.lastTime = null;
getAudio().resume();
getAudio().resumeMusic(g.perfectChain, g.flowCycles, g.balls.length);
setIsPaused(false);
g.rafId = requestAnimationFrame(tickRef.current);
} else {
g.paused = true;
if (g.rafId) cancelAnimationFrame(g.rafId);
getAudio().pause();
getAudio().pauseMusic();
setIsPaused(true);
}
}, [getAudio]);

const handlePointerMove = useCallback((e) => {
const g = gs.current;
if (!g.alive || g.paused || !arenaRef.current) return;
const rect = arenaRef.current.getBoundingClientRect();
const clientX = e.touches ? e.touches[0].clientX : e.clientX;
e.preventDefault();
const rawX = clientX - rect.left;
g.paddleX = Math.max(g.paddleW / 2, Math.min(g.arenaW - g.paddleW / 2, rawX));
}, []);

const handleNameKey = useCallback((e) => {
if (e.key === "Enter" && !scoreSubmitted) submitScore();
}, [scoreSubmitted, submitScore]);

useEffect(() => {
const arena = arenaRef.current;
if (!arena) return;
const ro = new ResizeObserver((entries) => {
for (const entry of entries) {
const { width, height } = entry.contentRect;
const g = gs.current;
g.arenaW = width;
g.arenaH = height;
g.paddleW = width * PADDLE_W_PCT;
if (paddleRef.current) paddleRef.current.style.width = `${g.paddleW}px`;
}
});
ro.observe(arena);
return () => ro.disconnect();
}, []);

useEffect(() => {
const onKey = (e) => {
if (e.code === "Space" || e.code === "Escape" || e.key.toLowerCase() === "p") {
e.preventDefault();
togglePause();
}
};
window.addEventListener("keydown", onKey);
return () => window.removeEventListener("keydown", onKey);
}, [togglePause]);

useEffect(() => {
const onVisibility = () => {
performanceRef.current.stressMs = 0;
performanceRef.current.stableMs = 0;
performanceRef.current.lastFrame = 0;
gs.current.lastTime = null;
};
document.addEventListener("visibilitychange", onVisibility);
return () => document.removeEventListener("visibilitychange", onVisibility);
}, []);

useEffect(() => {
return () => {
mountedRef.current = false;
gs.current.alive = false;
if (gs.current.rafId) cancelAnimationFrame(gs.current.rafId);
if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
getAudio().stopMusic();
};
}, [getAudio]);

const currentColor = SPECTRUM[colorIdx].color;
const currentShadow = SPECTRUM[colorIdx].shadow;
const chainDisplay = `${perfectChain}/${PERFECT_CHAIN_MAX}`;

return (
<div className="db-root">

<div className="db-hud">
<div className="db-hud-left">
<span
className="db-score"
style={{ color: currentColor, textShadow: `0 0 16px ${currentShadow}` }}
>
{score}
</span>
<span
className="db-color-label"
style={{ color: currentColor, textShadow: `0 0 10px ${currentShadow}` }}
>
{SPECTRUM[colorIdx].name}
</span>
</div>
<div className="db-hud-right">
<span className="db-stat">
<span className="db-stat-label">FLOW</span>
<span className="db-stat-value">{flowCycles}</span>
</span>
<span className="db-stat">
<span className="db-stat-label">CHAIN</span>
<span
className="db-stat-value"
style={{
color: perfectChain > 0 ? currentColor : undefined,
textShadow: perfectChain > 0 ? `0 0 8px ${currentShadow}` : undefined,
}}
>
{chainDisplay}
</span>
</span>
<span className="db-stat">
<span className="db-stat-label">BALLS</span>
<span className="db-stat-value">{ballCount}</span>
</span>
</div>
</div>

<div
className={`db-arena ${arenaClass}`}
ref={arenaRef}
onMouseMove={handlePointerMove}
onTouchMove={handlePointerMove}
onTouchStart={handlePointerMove}
>
{[0, 1, 2].map((ballIndex) =>
Array.from({ length: TRAIL_CAP }).map((_, trailIndex) => (
<div
key={`trail-${ballIndex}-${trailIndex}`}
className={`db-trail db-trail-${ballIndex}`}
ref={(el) => {
if (!trailRefs.current[ballIndex]) trailRefs.current[ballIndex] = [];
trailRefs.current[ballIndex][trailIndex] = el;
}}
/>
))
)}

{[0, 1, 2].map((i) => (
<div
key={i}
className="db-ball"
ref={(el) => { ballRefs.current[i] = el; }}
style={{ opacity: i < ballCount ? 1 : 0 }}
/>
))}

<div className="db-paddle" ref={paddleRef} style={{ bottom: `${PADDLE_Y_OFF}px` }} />

{eventMsg && <div className="db-event-msg">{eventMsg}</div>}

{phase === "idle" && (
<div className="db-overlay">
<div className="db-overlay-title">DOTBALL</div>
<div className="db-overlay-sub">Move cursor · Block the dots</div>
<div className="db-overlay-sub db-overlay-small">
Perfect → Spectrum → Multiplicity
</div>
<button className="db-btn" onClick={startGame}>START</button>
</div>
)}

{phase === "playing" && isPaused && (
<div className="db-overlay">
<div className="db-overlay-title">PAUSED</div>
<button className="db-btn" onClick={togglePause}>RESUME</button>
</div>
)}

{phase === "dead" && (
<div className="db-overlay">
<div className="db-overlay-title">GAME OVER</div>

<div className="db-final-score">{score}</div>
<div className="db-final-meta">
<span>FLOW {flowCycles}</span>
<span className="db-meta-dot">·</span>
<span>SPECTRUMS {gs.current.perfectSpectrumCount}</span>
<span className="db-meta-dot">·</span>
<span>BEST CHAIN {gs.current.bestChain}</span>
</div>

{!scoreSubmitted ? (
<>
<input
className="db-name-input"
value={playerName}
onChange={(e) => setPlayerName(sanitizeName(e.target.value))}
onKeyDown={handleNameKey}
maxLength={12}
placeholder="YOUR NAME"
autoComplete="off"
spellCheck={false}
/>
<button className="db-btn" onClick={submitScore}>
SAVE SCORE
</button>
</>
) : (
<div className="db-overlay-sub">✓ SCORE SAVED</div>
)}

<div className="db-leaderboard">
<div className="db-leaderboard-title">
TOP {Math.min(leaderboard.length, 10)}
</div>
{leaderboard.length === 0 ? (
<div className="db-overlay-sub">No scores yet</div>
) : (
leaderboard.map((entry, index) => (
<div
key={`${entry.name}-${entry.date}-${index}`}
className={`db-lb-row${index === newEntryIdx ? " db-lb-row--new" : ""}`}
>
<span className="db-lb-rank">{index + 1}</span>
<span className="db-lb-name">{entry.name}</span>
<span className="db-lb-meta">
F{entry.flowCycles ?? 0} · C{entry.bestChain ?? 0}
</span>
<span className="db-lb-score">{entry.score}</span>
</div>
))
)}
</div>

<div className="db-overlay-actions">
<button className="db-btn" onClick={startGame}>RETRY</button>
{leaderboard.length > 0 && (
<button className="db-btn db-btn--dim" onClick={resetLeaderboard}>
RESET
</button>
)}
</div>
</div>
)}
</div>

<div className="db-footer">
<span className="db-footer-label">ROYGBIV</span>
{SPECTRUM.map((s, i) => (
<span
key={s.name}
className="db-pip"
style={{
background: s.color,
boxShadow: i === colorIdx ? `0 0 8px 3px ${s.shadow}` : "none",
opacity: i === colorIdx ? 1 : 0.25,
transform: i === colorIdx ? "scale(1.35)" : "scale(1)",
}}
/>
))}
{phase === "playing" && (
<button className="db-pause-btn" onClick={togglePause} aria-label="Pause">
{isPaused ? "▶" : "⏸"}
</button>
)}
</div>

</div>
);
}

