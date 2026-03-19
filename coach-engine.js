/**
 * Shaun's Daily Health Coach — Engine
 * ====================================
 * Rule-based workout + nutrition planning engine.
 * Reads live Oura Ring data and generates daily plans based on
 * readiness, sleep, HRV, stress, and current recovery phase.
 *
 * No external dependencies. Runs entirely client-side.
 */

// ─────────────────────────────────────────────
// 1. CONFIGURATION
// ─────────────────────────────────────────────

const COACH_CONFIG = {
    user: {
        name: 'Shaun',
        age: 40,
        heightCm: 180,
        currentWeightKg: 92,
        startWeightKg: 92,
        goalWeightKg: 80,
        goalBodyFatPct: 18,
        goalTimelineMonths: 2.8,  // Aggressive cut: 12 weeks (Mar 9 – May 31)
        sex: 'male',
    },

    baselines: {
        hrvBalance: 48, // actual all-time average from 229 nights of data
        restingHR: { low: 46, high: 50 },
        deepSleepMinutes: 60,
        totalSleepHours: 7.5,
        stepsTarget: 10000,
    },

    conditions: {
        ibs: true,
        hypoglycemiaRisk: true,
        vitaminDDeficient: true,
        lowFerritin: true,
        highCortisol: true,
        highSHBG: true,
        subclinicalHyperthyroid: true,
    },

    events: {
        sinusInfectionStart: '2026-01-10',
        antibioticsStart: '2026-02-09',
        antibioticsEnd: '2026-02-14',
        concussionDate: '2026-01-25',
        concussionResolved: true,  // Mar 3, 2026 — concussion resolved. Lingering symptoms attributed to jaw issue.
        jawIssueIdentified: '2026-03-03',  // Jaw issue (suspected TMJ/dental) likely cause of evening headaches/dizziness
    },

    // Holiday mode — nutrition section shows relaxed guidance instead of strict meal plans
    holiday: {
        active: false,
        startDate: '2026-03-26',
        endDate: '2026-03-29',
        location: 'Rome',
        timezone: 'Europe/Rome',  // UTC+1 (CET) / UTC+2 (CEST in March)
    },

    phases: [
        {
            id: 'heal',
            name: 'Phase 1: Heal',
            description: 'Recover from infection + concussion. Completed early — concussion resolved, jaw issue identified separately.',
            startDate: '2026-02-14',
            endDate: '2026-03-02',
            color: '#f59e0b',
            colorBg: 'rgba(245, 158, 11, 0.15)',
            maxIntensity: 'easy',
            allowedTypes: ['walking', 'yoga', 'mobility', 'light_strength', 'core_stability', 'rest_day'],
            restrictions: ['No heading', 'No contact sports', 'No HIIT', 'No running'],
        },
        {
            id: 'rebuild',
            name: 'Phase 2: Rebuild',
            description: 'Hybrid athlete foundation: 3 lifts/week + 2 easy runs + football 2x/week. Lift heavy to preserve muscle during cut.',
            startDate: '2026-03-03',
            endDate: '2026-04-07',
            color: '#3b82f6',
            colorBg: 'rgba(59, 130, 246, 0.15)',
            maxIntensity: 'moderate',
            allowedTypes: ['walking', 'yoga', 'mobility', 'upper_strength', 'lower_strength', 'full_body_strength', 'core_stability', 'running_easy', 'running_tempo', 'running_long', 'football', 'football_prep', 'rest_day'],
            restrictions: [],
        },
        {
            id: 'push',
            name: 'Phase 3: Push',
            description: 'Progressive overload in gym, introduce tempo running. 3 lifts + 1 tempo + 1 easy run + football 2x/week.',
            startDate: '2026-04-08',
            endDate: '2026-06-30',
            color: '#10b981',
            colorBg: 'rgba(16, 185, 129, 0.15)',
            maxIntensity: 'hard',
            allowedTypes: ['all'],
            restrictions: [],
        },
        {
            id: 'sustain',
            name: 'Phase 4: Sustain',
            description: 'True 50/50 hybrid athlete. Maintenance calories, build running volume. 3 lifts + 1 tempo + 1 long run + football 2x/week.',
            startDate: '2026-07-01',
            endDate: '2026-12-31',
            color: '#8b5cf6',
            colorBg: 'rgba(139, 92, 246, 0.15)',
            maxIntensity: 'hard',
            allowedTypes: ['all'],
            restrictions: [],
        },
    ],
};


// ─────────────────────────────────────────────
// 2. DATE UTILITIES
// ─────────────────────────────────────────────

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function getDateStr(date) {
    return date.toISOString().split('T')[0];
}

function getDateNDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return getDateStr(d);
}

function daysBetween(dateStrA, dateStrB) {
    const a = new Date(dateStrA + 'T00:00:00');
    const b = typeof dateStrB === 'string' ? new Date(dateStrB + 'T00:00:00') : dateStrB;
    return Math.floor((b - a) / 86400000);
}

function getDayOfYear(date) {
    const d = date || new Date();
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
}

function getDayOfWeekMon0(date) {
    // 0=Mon, 1=Tue, ..., 6=Sun
    const d = date || new Date();
    const day = d.getDay();
    return day === 0 ? 6 : day - 1;
}

function formatDateLong(date) {
    return date.toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
}

function getWeekDates() {
    const today = new Date();
    const dayMon0 = getDayOfWeekMon0(today);
    const monday = new Date(today);
    monday.setDate(today.getDate() - dayMon0);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}


// ─────────────────────────────────────────────
// 3. PHASE DETECTION
// ─────────────────────────────────────────────

function getCurrentPhase(dateStr) {
    const date = new Date((dateStr || getTodayStr()) + 'T00:00:00');
    for (const phase of COACH_CONFIG.phases) {
        const start = new Date(phase.startDate + 'T00:00:00');
        const end = new Date(phase.endDate + 'T23:59:59');
        if (date >= start && date <= end) {
            const totalDays = Math.ceil((end - start) / 86400000);
            const elapsed = Math.ceil((date - start) / 86400000);
            return {
                ...phase,
                totalDays,
                elapsedDays: elapsed,
                progressPct: Math.min(100, Math.round((elapsed / totalDays) * 100)),
                daysRemaining: totalDays - elapsed,
            };
        }
    }
    // Beyond defined phases — default to sustain
    const last = COACH_CONFIG.phases[COACH_CONFIG.phases.length - 1];
    return { ...last, totalDays: 0, elapsedDays: 0, progressPct: 100, daysRemaining: 0 };
}


// ─────────────────────────────────────────────
// 4. OURA DATA FETCH
// ─────────────────────────────────────────────

async function fetchCoachData() {
    const today = getTodayStr();
    const weekAgo = getDateNDaysAgo(7);

    const endpoints = [
        'daily_readiness', 'daily_sleep', 'sleep',
        'daily_activity', 'daily_stress', 'daily_resilience',
    ];

    const results = await Promise.all(
        endpoints.map(ep =>
            fetch(`/api/${ep}?start_date=${weekAgo}&end_date=${today}`)
                .then(r => r.json())
                .catch(() => ({ data: [] }))
        )
    );

    const [readinessRes, sleepScoreRes, sleepDetailRes, activityRes, stressRes, resilienceRes] = results;

    const readinessData = readinessRes.data || [];
    const sleepScoreData = (sleepScoreRes.data || []);
    const sleepDetailData = (sleepDetailRes.data || []).filter(s => s.type === 'long_sleep');
    const activityData = activityRes.data || [];
    const stressData = stressRes.data || [];
    const resilienceData = resilienceRes.data || [];

    // Get today's data (last entry), fallback to yesterday
    const todayReadiness = readinessData[readinessData.length - 1] || {};
    const todaySleepScore = sleepScoreData[sleepScoreData.length - 1] || {};
    const todaySleepDetail = sleepDetailData[sleepDetailData.length - 1] || {};
    const todayActivity = activityData[activityData.length - 1] || {};
    const todayStress = stressData[stressData.length - 1] || {};
    const todayResilience = resilienceData[resilienceData.length - 1] || {};

    const usingYesterday = todayReadiness.day !== today;

    return {
        // Today's scores
        readinessScore: todayReadiness.score || 0,
        hrvBalance: todayReadiness.contributors?.hrv_balance || 0,
        tempDeviation: todayReadiness.contributors?.body_temperature || 0,
        sleepScore: todaySleepScore.score || 0,
        totalSleepSeconds: todaySleepDetail.total_sleep_duration || 0,
        deepSleepSeconds: todaySleepDetail.deep_sleep_duration || 0,
        remSleepSeconds: todaySleepDetail.rem_sleep_duration || 0,
        sleepHRV: todaySleepDetail.average_hrv || 0,
        restingHR: todaySleepDetail.lowest_heart_rate || 0,
        activityScore: todayActivity.score || 0,
        steps: todayActivity.steps || 0,
        activeCalories: todayActivity.active_calories || 0,
        stressLevel: todayStress.day_summary || 'unknown',
        resilienceLevel: todayResilience.level || 'unknown',

        // 7-day history for trends
        readinessHistory: readinessData.map(d => ({
            day: d.day,
            score: d.score || 0,
            hrv: d.contributors?.hrv_balance || 0,
        })),
        sleepHistory: sleepScoreData.map(d => ({
            day: d.day,
            score: d.score || 0,
        })),

        usingYesterday,
        dataDate: todayReadiness.day || 'N/A',
    };
}


// ─────────────────────────────────────────────
// 5. INTENSITY DETERMINATION
// ─────────────────────────────────────────────

const INTENSITY_ORDER = ['rest', 'easy', 'moderate', 'hard'];

function determineIntensity(ouraData, phase, journalEntry) {
    const { readinessScore, sleepScore, hrvBalance, stressLevel } = ouraData;
    const je = normaliseJournalEntry(journalEntry);

    // Base from readiness + HRV
    let intensity = 'easy';
    if (readinessScore >= 85 && hrvBalance >= 80) {
        intensity = 'hard';
    } else if (readinessScore >= 70 && hrvBalance >= 65) {
        intensity = 'moderate';
    } else if (readinessScore >= 55) {
        intensity = 'easy';
    } else {
        return 'rest';
    }

    // Downgrade if sleep was poor
    if (sleepScore < 60 && intensity === 'hard') intensity = 'moderate';
    if (sleepScore < 50) intensity = 'easy';

    // Downgrade if stressed
    if (stressLevel === 'stressful' && intensity === 'hard') intensity = 'moderate';

    // Journal-based downgrades (only applied when user accepts recommendation)
    if (je) {
        const symptoms = je.symptoms || [];
        const feeling = je.feeling || 3;

        // Feeling 1/5 → force rest
        if (feeling <= 1) return 'rest';

        // Dizziness → downgrade one level (may be jaw-related, not concussion)
        if (symptoms.includes('dizziness')) {
            const idx = INTENSITY_ORDER.indexOf(intensity);
            if (idx > 1) intensity = INTENSITY_ORDER[idx - 1];
        }
        // Multiple symptoms → force easy (still worth being cautious)
        const warnSymptoms = symptoms.filter(s =>
            ['headache', 'dizziness', 'brain_fog', 'light_sensitivity', 'nausea'].includes(s)
        );
        if (warnSymptoms.length >= 3) {
            intensity = 'easy';
        }

        // Feeling 2/5 → downgrade one level
        if (feeling <= 2 && intensity !== 'rest') {
            const idx = INTENSITY_ORDER.indexOf(intensity);
            if (idx > 1) intensity = INTENSITY_ORDER[idx - 1];
        }
    }

    // Cap by phase maximum
    const phaseMax = INTENSITY_ORDER.indexOf(phase.maxIntensity);
    const current = INTENSITY_ORDER.indexOf(intensity);
    if (current > phaseMax) {
        intensity = phase.maxIntensity;
    }

    return intensity;
}

function intensityLabel(intensity) {
    return intensity.charAt(0).toUpperCase() + intensity.slice(1);
}

function intensityColor(intensity) {
    const colors = {
        rest: '#a78bfa',
        easy: '#34d399',
        moderate: '#fbbf24',
        hard: '#f87171',
    };
    return colors[intensity] || '#a0a6b1';
}


// ─────────────────────────────────────────────
// 6. WORKOUT LIBRARY
// ─────────────────────────────────────────────

const WORKOUT_LIBRARY = {

    // ── WALKING ──
    walking: {
        name: 'Brisk Walk',
        icon: '🚶',
        type: 'cardio',
        variants: {
            easy: {
                duration: 30,
                description: '30-min walk at a comfortable pace',
                targetHR: '100-120 bpm',
                warmup: [],
                exercises: [
                    { name: 'Walk at comfortable pace', duration: '30 min', note: 'Zone 1-2. Flat route or gentle hills.' },
                ],
                cooldown: [
                    { name: 'Gentle calf + hamstring stretch', duration: '3 min' },
                ],
                notes: 'Great for IBS — promotes gut motility without stress. Get outside for vitamin D if sunny.',
            },
            moderate: {
                duration: 45,
                description: '45-min brisk walk with hills',
                targetHR: '110-130 bpm',
                warmup: [],
                exercises: [
                    { name: 'Brisk walk with incline sections', duration: '45 min', note: 'Push pace on uphills, recover on flats.' },
                ],
                cooldown: [
                    { name: 'Hip flexor + calf stretch', duration: '5 min' },
                ],
                notes: 'Zone 2 cardio. Great base-builder.',
            },
            hard: {
                duration: 60,
                description: '60-min power walk or hike',
                targetHR: '120-140 bpm',
                warmup: [],
                exercises: [
                    { name: 'Power walk / hike with elevation', duration: '60 min', note: 'Sustained effort. Use trekking poles if available.' },
                ],
                cooldown: [
                    { name: 'Full lower body stretch', duration: '5 min' },
                ],
            },
        },
    },

    // ── YOGA & MOBILITY ──
    yoga: {
        name: 'Yoga & Mobility',
        icon: '🧘',
        type: 'recovery',
        variants: {
            easy: {
                duration: 20,
                description: '20-min gentle yoga flow',
                warmup: [],
                exercises: [
                    { name: 'Cat-cow stretches', duration: '2 min' },
                    { name: 'Downward dog to cobra flow', sets: 5, note: 'Slow, breathe through each transition' },
                    { name: 'Low lunge (hip opener)', duration: '1 min each side' },
                    { name: 'Pigeon pose', duration: '1 min each side' },
                    { name: 'Seated forward fold', duration: '1 min' },
                    { name: 'Supine twist', duration: '1 min each side' },
                    { name: 'Savasana with breathwork', duration: '3 min', note: 'Box breathing: 4 in, 4 hold, 4 out, 4 hold' },
                ],
                cooldown: [],
                notes: 'Focus on breath. Great for cortisol reduction and gut-brain axis.',
            },
            moderate: {
                duration: 30,
                description: '30-min yoga flow with holds',
                warmup: [],
                exercises: [
                    { name: 'Sun salutation A', sets: 3 },
                    { name: 'Sun salutation B', sets: 2 },
                    { name: 'Warrior I → II → Triangle flow', duration: '3 min each side' },
                    { name: 'Chair pose hold', duration: '30s', sets: 3 },
                    { name: 'Deep hip openers (pigeon, lizard)', duration: '2 min each side' },
                    { name: 'Bridge pose', duration: '30s', sets: 3 },
                    { name: 'Seated twist', duration: '1 min each side' },
                    { name: 'Legs up the wall', duration: '3 min' },
                ],
                cooldown: [],
            },
        },
    },

    // ── MOBILITY & FOAM ROLLING ──
    mobility: {
        name: 'Mobility & Foam Rolling',
        icon: '🔄',
        type: 'recovery',
        variants: {
            easy: {
                duration: 15,
                description: '15-min mobility routine',
                warmup: [],
                exercises: [
                    { name: 'Foam roll quads', duration: '1 min each' },
                    { name: 'Foam roll IT band', duration: '1 min each' },
                    { name: 'Foam roll upper back', duration: '2 min' },
                    { name: 'Hip 90/90 stretch', duration: '1 min each side' },
                    { name: 'World\'s greatest stretch', reps: '5 each side' },
                    { name: 'Ankle circles + calf stretch', duration: '1 min each' },
                ],
                cooldown: [],
                notes: 'Perfect for recovery days or post-football.',
            },
            moderate: {
                duration: 25,
                description: '25-min deep mobility session',
                warmup: [],
                exercises: [
                    { name: 'Foam roll full body', duration: '8 min', note: 'Quads, hamstrings, IT band, back, lats' },
                    { name: 'Hip 90/90 transitions', reps: '8 each side' },
                    { name: 'Deep squat hold', duration: '2 min total', note: 'Hold onto something if needed' },
                    { name: 'T-spine rotations', reps: '10 each side' },
                    { name: 'Shoulder dislocates (band)', reps: 15 },
                    { name: 'Pigeon pose', duration: '90s each side' },
                    { name: 'Ankle dorsiflexion stretch', duration: '1 min each' },
                ],
                cooldown: [],
            },
        },
    },

    // ── LIGHT STRENGTH (Phase 1 only) ──
    light_strength: {
        name: 'Light Strength',
        icon: '🏋️',
        type: 'strength',
        variants: {
            easy: {
                duration: 25,
                description: '25-min light full-body strength',
                warmup: [
                    { name: 'Arm circles', duration: '30s each direction' },
                    { name: 'Bodyweight squats', reps: 10 },
                    { name: 'Cat-cow', reps: 8 },
                ],
                exercises: [
                    { name: 'Push-ups (knees if needed)', sets: 3, reps: '8-10', rest: '60s' },
                    { name: 'Bodyweight squats', sets: 3, reps: 12, rest: '60s' },
                    { name: 'Dumbbell rows (light)', sets: 3, reps: '10 each', rest: '60s' },
                    { name: 'Glute bridges', sets: 3, reps: 12, rest: '45s' },
                    { name: 'Dead bug', sets: 2, reps: '8 each side', rest: '30s' },
                ],
                cooldown: [
                    { name: 'Chest stretch (doorway)', duration: '30s each side' },
                    { name: 'Hamstring stretch', duration: '30s each' },
                ],
                notes: 'Keep it light. This is about reconnecting with movement, not pushing limits.',
            },
        },
    },

    // ── CORE & STABILITY ──
    core_stability: {
        name: 'Core & Stability',
        icon: '🎯',
        type: 'strength',
        variants: {
            easy: {
                duration: 20,
                description: '20-min core circuit',
                warmup: [
                    { name: 'Cat-cow', reps: 8 },
                    { name: 'Pelvic tilts', reps: 10 },
                ],
                exercises: [
                    { name: 'Dead bug', sets: 3, reps: '8 each side', rest: '30s' },
                    { name: 'Bird dog', sets: 3, reps: '8 each side', rest: '30s' },
                    { name: 'Plank hold', sets: 3, reps: '20-30s', rest: '30s' },
                    { name: 'Glute bridges', sets: 3, reps: 12, rest: '30s' },
                    { name: 'Side plank', sets: 2, reps: '15-20s each side', rest: '30s' },
                ],
                cooldown: [
                    { name: 'Child\'s pose', duration: '1 min' },
                    { name: 'Supine twist', duration: '30s each side' },
                ],
            },
            moderate: {
                duration: 30,
                description: '30-min core + stability',
                warmup: [
                    { name: 'Cat-cow', reps: 10 },
                    { name: 'Inchworm', reps: 5 },
                ],
                exercises: [
                    { name: 'Dead bug', sets: 3, reps: '10 each side', rest: '30s' },
                    { name: 'Bird dog', sets: 3, reps: '10 each side', rest: '30s' },
                    { name: 'Plank hold', sets: 3, reps: '30-45s', rest: '30s' },
                    { name: 'Side plank with rotation', sets: 3, reps: '8 each side', rest: '30s' },
                    { name: 'Pallof press (band)', sets: 3, reps: '10 each side', rest: '30s' },
                    { name: 'Single-leg glute bridge', sets: 3, reps: '10 each', rest: '30s' },
                    { name: 'Mountain climbers (slow)', sets: 3, reps: '10 each side', rest: '30s' },
                ],
                cooldown: [
                    { name: 'Child\'s pose', duration: '1 min' },
                    { name: 'Supine twist', duration: '30s each side' },
                    { name: 'Hip flexor stretch', duration: '30s each' },
                ],
            },
            hard: {
                duration: 35,
                description: '35-min advanced core',
                warmup: [
                    { name: 'Cat-cow', reps: 10 },
                    { name: 'Inchworm to push-up', reps: 5 },
                ],
                exercises: [
                    { name: 'Ab wheel rollout (or slider)', sets: 3, reps: 10, rest: '45s' },
                    { name: 'Hanging knee raises', sets: 3, reps: 12, rest: '45s' },
                    { name: 'Plank to push-up', sets: 3, reps: '8 each arm', rest: '45s' },
                    { name: 'Side plank with hip dip', sets: 3, reps: '10 each side', rest: '30s' },
                    { name: 'Pallof press (band)', sets: 3, reps: '12 each side', rest: '30s' },
                    { name: 'Single-leg deadlift (BW)', sets: 3, reps: '10 each', rest: '45s' },
                    { name: 'Mountain climbers', sets: 3, reps: '15 each side', rest: '30s' },
                    { name: 'Hollow body hold', sets: 3, reps: '20-30s', rest: '30s' },
                ],
                cooldown: [
                    { name: 'Child\'s pose', duration: '1 min' },
                    { name: 'Full body stretch', duration: '3 min' },
                ],
            },
        },
    },

    // ── UPPER BODY STRENGTH ──
    upper_strength: {
        name: 'Upper Body Strength',
        icon: '💪',
        type: 'strength',
        restStyle: 'Treadmill walk between sets: 5.5 km/h, incline 4-6%',
        variants: {
            easy: {
                duration: 25,
                description: '25-min light upper body + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '2 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Arm circles + band pull-aparts', duration: '1 min' },
                ],
                exercises: [
                    { name: 'Push-ups', sets: 3, reps: '8-10', rest: '45s treadmill walk' },
                    { name: 'Dumbbell rows', sets: 3, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Overhead press (DB)', sets: 2, reps: '8-10', rest: '45s treadmill walk' },
                    { name: 'Bicep curls', sets: 2, reps: 12, rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Chest + shoulder stretch', duration: '1 min' },
                ],
            },
            moderate: {
                duration: 35,
                description: '35-min upper body strength + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Arm circles + band pull-aparts + light push-ups', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Push-ups', sets: 4, reps: '12-15', rest: '45s treadmill walk' },
                    { name: 'Dumbbell rows', sets: 4, reps: '10-12 each', rest: '45s treadmill walk' },
                    { name: 'Overhead press (DB)', sets: 3, reps: '10-12', rest: '45s treadmill walk' },
                    { name: 'Lateral raises', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Hammer curls', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Tricep dips (chair)', sets: 3, reps: '10-12', rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Chest + shoulder + tricep stretch', duration: '2 min' },
                ],
            },
            hard: {
                duration: 45,
                description: '45-min upper body — treadmill between every set',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 5-7% incline' },
                    { name: 'Arm circles + band pull-aparts + push-ups', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Push-ups (weighted or elevated feet)', sets: 4, reps: '15-20', rest: '45s treadmill walk' },
                    { name: 'Dumbbell rows (heavy)', sets: 4, reps: '8-10 each', rest: '45s treadmill walk' },
                    { name: 'Overhead press (DB)', sets: 4, reps: '10-12', rest: '45s treadmill walk' },
                    { name: 'Superset: Lateral raises + Front raises', sets: 3, reps: '12 each', rest: '45s treadmill walk' },
                    { name: 'Superset: Curls + Skull crushers', sets: 3, reps: '12 each', rest: '45s treadmill walk' },
                    { name: 'Diamond push-ups', sets: 3, reps: '10-12', rest: '45s treadmill walk' },
                    { name: 'Face pulls (band)', sets: 3, reps: 15, rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Full upper body stretch', duration: '3 min' },
                ],
            },
        },
    },

    // ── LOWER BODY STRENGTH ──
    lower_strength: {
        name: 'Lower Body Strength',
        icon: '🦵',
        type: 'strength',
        restStyle: 'Treadmill walk between sets: 5.5 km/h, incline 4-6%',
        variants: {
            easy: {
                duration: 25,
                description: '25-min light lower body + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '2 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Bodyweight squats + leg swings', duration: '1 min' },
                ],
                exercises: [
                    { name: 'Goblet squats', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Romanian deadlift (DB)', sets: 3, reps: 10, rest: '45s treadmill walk' },
                    { name: 'Walking lunges', sets: 2, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Calf raises', sets: 3, reps: 15, rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Quad + hamstring + hip flexor stretch', duration: '2 min' },
                ],
            },
            moderate: {
                duration: 35,
                description: '35-min lower body strength + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Bodyweight squats + leg swings + glute bridges', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Goblet squats (heavy DB)', sets: 4, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Romanian deadlift (DB)', sets: 4, reps: 10, rest: '45s treadmill walk' },
                    { name: 'Bulgarian split squat', sets: 3, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Hip thrust (weighted)', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Lateral lunges', sets: 3, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Calf raises (single leg)', sets: 3, reps: '12 each', rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Pigeon pose + hamstring + quad stretch', duration: '3 min' },
                ],
            },
            hard: {
                duration: 45,
                description: '45-min lower body — treadmill between every set',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 5-7% incline' },
                    { name: 'Bodyweight squats + inchworm + glute bridges', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Goblet squats (heaviest DB)', sets: 4, reps: '10-12', rest: '45s treadmill walk' },
                    { name: 'Romanian deadlift (heavy DB)', sets: 4, reps: '8-10', rest: '45s treadmill walk' },
                    { name: 'Bulgarian split squat (DB)', sets: 4, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Superset: Hip thrust + Jump squats', sets: 3, reps: '12 / 8', rest: '45s treadmill walk' },
                    { name: 'Walking lunges (DB)', sets: 3, reps: '12 each', rest: '45s treadmill walk' },
                    { name: 'Single-leg calf raise', sets: 3, reps: '15 each', rest: '45s treadmill walk' },
                    { name: 'Wall sit', sets: 2, reps: '45s hold', rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Full lower body stretch', duration: '3 min' },
                ],
            },
        },
    },

    // ── FULL BODY STRENGTH ──
    full_body_strength: {
        name: 'Full Body Strength',
        icon: '🏋️',
        type: 'strength',
        restStyle: 'Treadmill walk between sets: 5.5 km/h, incline 4-6%',
        variants: {
            easy: {
                duration: 30,
                description: '30-min full body + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '2 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Arm circles + leg swings', duration: '1 min' },
                ],
                exercises: [
                    { name: 'Push-ups', sets: 3, reps: 10, rest: '45s treadmill walk' },
                    { name: 'Goblet squats', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Dumbbell rows', sets: 3, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Glute bridges', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Plank', sets: 2, reps: '30s', rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Full body stretch', duration: '3 min' },
                ],
            },
            moderate: {
                duration: 40,
                description: '40-min full body circuit + treadmill rest',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 4-6% incline' },
                    { name: 'Inchworm + bodyweight squats', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Push-ups', sets: 4, reps: 15, rest: '45s treadmill walk' },
                    { name: 'Goblet squats', sets: 4, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Dumbbell rows', sets: 4, reps: '10 each', rest: '45s treadmill walk' },
                    { name: 'Romanian deadlift', sets: 3, reps: 10, rest: '45s treadmill walk' },
                    { name: 'Overhead press', sets: 3, reps: 10, rest: '45s treadmill walk' },
                    { name: 'Plank', sets: 3, reps: '40s', rest: '45s treadmill walk' },
                    { name: 'Bicep curls', sets: 2, reps: 12, rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Full body stretch', duration: '3 min' },
                ],
            },
            hard: {
                duration: 50,
                description: '50-min full body — treadmill between every set',
                warmup: [
                    { name: 'Incline treadmill walk', duration: '3 min', note: '5.5 km/h, 5-7% incline' },
                    { name: 'Dynamic stretching', duration: '2 min' },
                ],
                exercises: [
                    { name: 'Superset: Push-ups + Goblet squats', sets: 4, reps: '15 / 12', rest: '45s treadmill walk' },
                    { name: 'Superset: DB rows + Romanian DL', sets: 4, reps: '10 each / 10', rest: '45s treadmill walk' },
                    { name: 'Superset: Overhead press + Lunges', sets: 3, reps: '10 / 10 each', rest: '45s treadmill walk' },
                    { name: 'Superset: Curls + Skull crushers', sets: 3, reps: 12, rest: '45s treadmill walk' },
                    { name: 'Core circuit: Plank 45s, Dead bug 10ea, Mountain climbers 15ea', sets: 2, rest: '45s treadmill walk' },
                ],
                cooldown: [
                    { name: 'Treadmill cooldown walk', duration: '2 min', note: 'Flat, easy pace' },
                    { name: 'Full body stretch', duration: '3 min' },
                ],
            },
        },
    },

    // ── EASY RUN (Phase 2+) ──
    running_easy: {
        name: 'Easy Run',
        icon: '🏃',
        type: 'cardio',
        variants: {
            easy: {
                duration: 20,
                description: '20-min easy jog — conversational pace',
                targetHR: '120-140 bpm',
                warmup: [
                    { name: 'Walk 3 min then light jog 2 min', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Easy jog', duration: '15 min', note: 'You should be able to hold a conversation. If not, slow down.' },
                ],
                cooldown: [
                    { name: 'Walk 3 min', duration: '3 min' },
                    { name: 'Calf + hamstring + quad stretch', duration: '3 min' },
                ],
                notes: 'First run back? Start with run/walk intervals: 2 min jog / 1 min walk x 5.',
            },
            moderate: {
                duration: 30,
                description: '30-min steady run',
                targetHR: '130-150 bpm',
                warmup: [
                    { name: 'Walk 2 min then light jog 3 min', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Steady run', duration: '25 min', note: 'Consistent pace. Zone 2-3.' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + full lower body stretch', duration: '5 min' },
                ],
            },
            hard: {
                duration: 40,
                description: '40-min run with tempo intervals',
                targetHR: '140-165 bpm',
                warmup: [
                    { name: 'Easy jog', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Steady run', duration: '10 min', note: 'Build to tempo pace' },
                    { name: 'Tempo intervals: 3 min hard / 2 min easy', sets: 4, note: 'Push to 160+ bpm on hard intervals' },
                    { name: 'Cool-down jog', duration: '5 min' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + full stretch', duration: '5 min' },
                ],
            },
        },
    },

    // ── TEMPO RUN (Phase 2+) ──
    running_tempo: {
        name: 'Tempo Run',
        icon: '🏃',
        type: 'cardio',
        variants: {
            easy: {
                duration: 25,
                description: '25-min tempo session — shortened intervals',
                targetHR: '145-160 bpm',
                warmup: [
                    { name: 'Easy jog', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Tempo intervals: 2 min hard / 1 min recovery jog', sets: 4, note: 'Hard = a pace where you could speak in short sentences but wouldn\'t want to.' },
                    { name: 'Easy jog', duration: '3 min' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + calf/hamstring stretch', duration: '5 min' },
                ],
                notes: 'First tempo session? Run the hard intervals at a pace where talking feels uncomfortable. That\'s the right effort.',
            },
            moderate: {
                duration: 35,
                description: '35-min tempo — building threshold fitness',
                targetHR: '150-165 bpm',
                warmup: [
                    { name: 'Easy jog', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Tempo intervals: 3 min hard / 90s recovery jog', sets: 4, note: 'Consistent effort each interval. Don\'t go out too fast.' },
                    { name: 'Easy jog', duration: '3 min' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + full lower body stretch', duration: '5 min' },
                ],
            },
            hard: {
                duration: 45,
                description: '45-min threshold session',
                targetHR: '155-170 bpm',
                warmup: [
                    { name: 'Easy jog', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Tempo intervals: 4 min hard / 1 min recovery jog', sets: 5, note: 'Comfortably uncomfortable. You should be working but not dying.' },
                    { name: 'Easy jog', duration: '5 min' },
                ],
                cooldown: [
                    { name: 'Walk 5 min + deep stretch (calves, quads, hips)', duration: '7 min' },
                ],
                notes: 'This is threshold work. You\'re building the engine. Push the pace but keep form clean.',
            },
        },
    },

    // ── LONG RUN (Phase 4 / Sustain) ──
    running_long: {
        name: 'Long Run',
        icon: '🏃',
        type: 'cardio',
        variants: {
            easy: {
                duration: 40,
                description: '40-min easy long run',
                targetHR: '120-140 bpm',
                warmup: [
                    { name: 'Walk 3 min then light jog 2 min', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Easy jog', duration: '30 min', note: 'Conversational pace. If you can\'t talk, slow down.' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + full stretch', duration: '5 min' },
                ],
                notes: 'Building your aerobic base. The pace should feel almost too easy. That\'s the point.',
            },
            moderate: {
                duration: 55,
                description: '55-min steady Zone 2 run',
                targetHR: '130-150 bpm',
                warmup: [
                    { name: 'Walk 2 min then easy jog 3 min', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Steady run', duration: '45 min', note: 'Zone 2 — you can talk in short sentences. Consistent pace throughout.' },
                ],
                cooldown: [
                    { name: 'Walk 3 min + full lower body stretch', duration: '5 min' },
                ],
            },
            hard: {
                duration: 75,
                description: '75-min long run with negative split',
                targetHR: '135-155 bpm',
                warmup: [
                    { name: 'Easy jog', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Long run — first half easy', duration: '30 min', note: 'Conversational. Save your legs.' },
                    { name: 'Long run — second half faster', duration: '30 min', note: 'Pick up the pace. Finish faster than you started.' },
                ],
                cooldown: [
                    { name: 'Walk 5 min + deep stretch + foam roll if available', duration: '10 min' },
                ],
                notes: 'This is your weekly long run. Negative split = second half faster than first. Don\'t be a hero early.',
            },
        },
    },

    // ── FOOTBALL ──
    football: {
        name: 'Football',
        icon: '⚽',
        type: 'sport',
        variants: {
            easy: {
                duration: 60,
                description: 'Light 5-a-side or training session',
                warmup: [
                    { name: 'Dynamic stretching', duration: '5 min' },
                    { name: 'Light jog with ball', duration: '5 min' },
                ],
                exercises: [
                    { name: 'Football match / training', duration: '50 min', note: 'Keep intensity at 70%.' },
                ],
                cooldown: [
                    { name: 'Walk + static stretching', duration: '5 min' },
                ],
                notes: 'Hydrate well before and after. Take electrolytes if playing > 45 min.',
            },
            moderate: {
                duration: 75,
                description: 'Competitive 5-a-side or training',
                warmup: [
                    { name: 'Dynamic warm-up', duration: '10 min' },
                ],
                exercises: [
                    { name: 'Football match', duration: '60 min', note: 'Full effort. Monitor for dizziness.' },
                ],
                cooldown: [
                    { name: 'Cool-down walk + stretch', duration: '10 min' },
                ],
                notes: 'Post-game: protein shake within 30 min.',
            },
            hard: {
                duration: 90,
                description: 'Full match — all out',
                warmup: [
                    { name: 'Dynamic warm-up + sprint drills', duration: '15 min' },
                ],
                exercises: [
                    { name: 'Full 90-min match', duration: '90 min', note: 'Pace yourself. Half-time refuel.' },
                ],
                cooldown: [
                    { name: 'Walk + deep stretch + foam roll', duration: '15 min' },
                ],
                notes: 'Critical: eat a proper meal within 2 hours. Extra carbs + protein.',
            },
        },
    },

    // ── FOOTBALL PREP ──
    football_prep: {
        name: 'Pre-Match Prep',
        icon: '⚽',
        type: 'recovery',
        variants: {
            easy: {
                duration: 15,
                description: '15-min activation before football',
                warmup: [],
                exercises: [
                    { name: 'Dynamic leg swings', reps: '10 each direction, each leg' },
                    { name: 'Hip circles', reps: '10 each direction' },
                    { name: 'Bodyweight squats', reps: 10 },
                    { name: 'Lateral shuffles', duration: '1 min' },
                    { name: 'Light jog with high knees', duration: '2 min' },
                    { name: 'Sprint build-ups (50%→80%)', reps: 3, note: '30m each' },
                ],
                cooldown: [],
                notes: 'Do this 30 min before kick-off. Keep it light — save energy for the match.',
            },
        },
    },

    // ── REST DAY ──
    rest_day: {
        name: 'Active Recovery',
        icon: '😴',
        type: 'rest',
        variants: {
            easy: {
                duration: 15,
                description: 'Gentle movement only',
                warmup: [],
                exercises: [
                    { name: 'Light walk', duration: '10-15 min', note: 'Easy pace. No structure needed.' },
                    { name: 'Gentle stretching', duration: '5-10 min', note: 'Whatever feels good.' },
                ],
                cooldown: [],
                notes: 'Focus on sleep quality tonight. No structured training. Breathwork or meditation encouraged.',
            },
        },
    },
};


// ─────────────────────────────────────────────
// 7. WEEKLY SCHEDULE TEMPLATES
// ─────────────────────────────────────────────

const PHASE_SCHEDULES = {
    heal: [
        'walking',           // Mon
        'yoga',              // Tue
        'light_strength',    // Wed
        'walking',           // Thu
        'core_stability',    // Fri
        'mobility',          // Sat
        'rest_day',          // Sun
    ],
    rebuild: [
        'upper_strength',    // Mon — push/pull
        'running_easy',      // Tue — easy run (building base)
        'football',          // Wed
        'lower_strength',    // Thu — legs/posterior chain
        'running_easy',      // Fri — easy run
        'full_body_strength',// Sat — compound movements
        'football',          // Sun
    ],
    push: [
        'upper_strength',    // Mon — push/pull
        'running_tempo',     // Tue — introduce tempo work
        'football',          // Wed
        'lower_strength',    // Thu — legs/posterior chain
        'running_easy',      // Fri — keep one easy run
        'full_body_strength',// Sat — compound movements
        'football',          // Sun
    ],
    sustain: [
        'upper_strength',    // Mon — push/pull
        'running_tempo',     // Tue — tempo stays
        'football',          // Wed
        'lower_strength',    // Thu — legs/posterior chain
        'running_long',      // Fri — build endurance
        'full_body_strength',// Sat — compound movements
        'football',          // Sun
    ],
};

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];


// ─────────────────────────────────────────────
// 8. WORKOUT SELECTION
// ─────────────────────────────────────────────

function selectTodayWorkout(ouraData, phase, dateOverride, journalEntry) {
    const today = dateOverride || new Date();
    const dayIdx = getDayOfWeekMon0(today);
    const schedule = PHASE_SCHEDULES[phase.id] || PHASE_SCHEDULES.heal;
    let plannedType = schedule[dayIdx];
    const je = normaliseJournalEntry(journalEntry);
    const intensity = determineIntensity(ouraData, phase, je);
    let journalSwapped = false;

    // Rest override
    if (intensity === 'rest') {
        const restTemplate = WORKOUT_LIBRARY.rest_day.variants.easy;
        return {
            workout: restTemplate,
            typeKey: 'rest_day',
            name: 'Rest Day (Body Override)',
            icon: '😴',
            intensity: 'rest',
            reason: je && (je.feeling || 3) <= 1
                ? `Feeling ${je.feeling}/5 — your body needs rest today.`
                : `Readiness ${ouraData.readinessScore} is below 55 — your body needs rest today.`,
            alternatives: [],
            journalSwapped: false,
        };
    }

    // Dizziness swap: replace football/running with walking (balance issues make these unsafe)
    if (je && (je.symptoms || []).includes('dizziness')) {
        if (['football', 'running_easy', 'running_tempo', 'running_long'].includes(plannedType)) {
            plannedType = 'walking';
            journalSwapped = true;
        }
    }

    const template = WORKOUT_LIBRARY[plannedType];
    if (!template) return null;

    // Get the right variant (fallback chain: requested → easy)
    const variant = template.variants[intensity] || template.variants.easy;

    // Build alternatives (same intensity, different workout types)
    const alternatives = Object.keys(WORKOUT_LIBRARY)
        .filter(k => k !== plannedType && k !== 'rest_day' && k !== 'football_prep')
        .filter(k => {
            const lib = WORKOUT_LIBRARY[k];
            return lib.variants[intensity] || lib.variants.easy;
        })
        .filter(k => {
            if (phase.allowedTypes[0] === 'all') return true;
            return phase.allowedTypes.includes(k);
        })
        .slice(0, 4);

    return {
        workout: variant,
        typeKey: plannedType,
        name: `${template.name} (${intensityLabel(intensity)})`,
        icon: template.icon,
        intensity,
        reason: buildReasonString(ouraData, intensity, journalEntry),
        alternatives,
        journalSwapped,
    };
}

function buildReasonString(ouraData, intensity, journalEntry) {
    const je = normaliseJournalEntry(journalEntry);
    const parts = [];
    parts.push(`Readiness ${ouraData.readinessScore}`);
    if (ouraData.hrvBalance > 0) parts.push(`HRV ${ouraData.hrvBalance}`);
    if (ouraData.sleepScore > 0 && ouraData.sleepScore < 70) parts.push(`Sleep ${ouraData.sleepScore}`);
    if (ouraData.stressLevel === 'stressful') parts.push('Stressed');

    // Journal signal strings
    if (je) {
        const symptoms = je.symptoms || [];
        const feeling = je.feeling || 3;
        if (symptoms.includes('dizziness')) parts.push('Dizziness reported');
        else if (symptoms.includes('headache')) parts.push('Headache reported');
        if (symptoms.includes('nausea')) parts.push('Nausea reported');
        if (feeling <= 1) parts.push('Feeling rough (1/5)');
        else if (feeling <= 2) parts.push('Feeling low (2/5)');
    }

    const labels = {
        hard: 'green light for intensity',
        moderate: 'moderate intensity recommended',
        easy: 'take it easy today',
        rest: 'body needs recovery',
    };

    return `${parts.join(' · ')} — ${labels[intensity] || ''}`;
}

function getAlternativeWorkout(typeKey, intensity) {
    const template = WORKOUT_LIBRARY[typeKey];
    if (!template) return null;
    const variant = template.variants[intensity] || template.variants.easy;
    return {
        workout: variant,
        typeKey,
        name: `${template.name} (${intensityLabel(intensity)})`,
        icon: template.icon,
        intensity,
    };
}


// ─────────────────────────────────────────────
// 9. NUTRITION ENGINE
// ─────────────────────────────────────────────

function calculateDailyTargets(workoutTypeKey, ouraData, intensity, journalEntry) {
    const { currentWeightKg, goalWeightKg, heightCm, age, sex, goalTimelineMonths } = COACH_CONFIG.user;

    // BMR (Mifflin-St Jeor)
    const bmr = (10 * currentWeightKg) + (6.25 * heightCm) - (5 * age) + (sex === 'male' ? 5 : -161);

    // TDEE — moderate activity multiplier
    const tdee = Math.round(bmr * 1.55);

    // Deficit for weight loss
    const totalWeeksToGoal = goalTimelineMonths * 4.33;
    const weeklyLossKg = (currentWeightKg - goalWeightKg) / totalWeeksToGoal;
    const dailyDeficit = Math.min(1200, Math.max(300, Math.round((weeklyLossKg * 7700) / 7)));

    let calories = tdee - dailyDeficit;

    // Adjust for workout type
    if (['football', 'running_easy', 'running_tempo', 'running_long'].includes(workoutTypeKey)) {
        calories += 200;
    } else if (workoutTypeKey === 'rest_day') {
        calories -= 100;
    }

    // Oura-reactive calorie adjustments
    if (ouraData && ouraData.readinessScore > 0) {
        if (ouraData.readinessScore < 55) {
            calories -= 200;
        } else if (ouraData.readinessScore < 70 && workoutTypeKey !== 'rest_day' && workoutTypeKey !== 'yoga' && workoutTypeKey !== 'mobility') {
            calories -= 100;
        } else if (ouraData.readinessScore >= 85 && intensity === 'hard') {
            calories += 100;
        }
    }

    // Journal-based calorie adjustments (capped at -200 total from journal)
    const je = normaliseJournalEntry(journalEntry);
    if (je) {
        let journalAdj = 0;
        const symptoms = je.symptoms || [];
        const feeling = je.feeling || 3;

        if (symptoms.includes('gut_issues')) journalAdj -= 100;
        if (symptoms.includes('nausea')) journalAdj -= 100;
        if (feeling <= 1) journalAdj -= 100;
        else if (feeling <= 2) journalAdj -= 50;

        calories += Math.max(-200, journalAdj);
    }

    calories = Math.round(calories);

    // Macros
    const proteinG = Math.round(currentWeightKg * 1.8);
    const proteinCal = proteinG * 4;
    const fatCal = Math.round(calories * 0.28);
    const fatG = Math.round(fatCal / 9);
    const carbCal = calories - proteinCal - fatCal;
    const carbG = Math.round(carbCal / 4);

    return {
        calories,
        protein: proteinG,
        carbs: Math.max(0, carbG),
        fat: fatG,
        fiber: 30,
        waterL: 3.0,
        tdee,
        deficit: dailyDeficit,
        weeklyLossKg: Math.round(weeklyLossKg * 100) / 100,
    };
}


// ── MEAL TEMPLATES ──

const MEAL_TEMPLATES = {
    breakfast: {
        time: '7:30 AM',
        note: 'Eat within 1 hour of waking — prevents hypoglycemia dip',
        options: [
            {
                name: 'Protein Oats',
                ingredients: ['50g oats', '1 scoop whey protein', '1 banana', '15g peanut butter', '250ml oat milk'],
                macros: { cal: 510, protein: 37, carb: 62, fat: 14 },
                ibsNote: 'Soaked oats are gentler on digestion. Oat milk avoids lactose.',
            },
            {
                name: 'Eggs on Toast',
                ingredients: ['3 eggs (scrambled)', '2 slices bread', '1/2 avocado', 'handful spinach', '1 tsp olive oil'],
                macros: { cal: 530, protein: 30, carb: 38, fat: 28 },
                ibsNote: 'Sourdough fermentation reduces FODMAP content.',
            },
            {
                name: 'Greek Yogurt Bowl',
                ingredients: ['250g Greek yogurt', '40g granola', '1 banana', '15g honey', '15g chia seeds'],
                macros: { cal: 500, protein: 32, carb: 56, fat: 13 },
                ibsNote: 'If dairy-sensitive, swap for coconut yogurt.',
            },
            {
                name: 'PB & Banana Toast',
                ingredients: ['2 slices bread', '2 tbsp peanut butter', '1 banana', 'drizzle honey', '1 scoop whey (shake on side)'],
                macros: { cal: 520, protein: 35, carb: 58, fat: 16 },
                ibsNote: 'Simple, fast fuel. Toast is easy on the gut.',
            },
            {
                name: 'Smoothie Bowl',
                ingredients: ['1 scoop whey', '1 banana', '100g frozen berries', '40g oats', '250ml oat milk', '15g almond butter'],
                macros: { cal: 510, protein: 35, carb: 58, fat: 15 },
                ibsNote: 'Blend smooth for easier digestion.',
            },
            // Cut-phase options (~350 kcal, 30g+ protein)
            {
                name: '3-Egg Omelette',
                ingredients: ['3 eggs', 'handful spinach', 'peppers', 'mushrooms', '1 tsp olive oil'],
                macros: { cal: 340, protein: 26, carb: 6, fat: 22 },
                ibsNote: 'No bread = fewer carbs and lower FODMAP.',
                cutPhase: true,
            },
            {
                name: 'Protein Smoothie',
                ingredients: ['1 scoop whey protein', '100g frozen berries', 'handful spinach', '250ml water'],
                macros: { cal: 200, protein: 27, carb: 18, fat: 3 },
                ibsNote: 'Light on the gut. Berries add fibre without FODMAP issues.',
                cutPhase: true,
            },
            {
                name: 'Greek Yogurt & Berries',
                ingredients: ['200g Greek yogurt', '100g mixed berries', '1 scoop whey protein'],
                macros: { cal: 310, protein: 40, carb: 24, fat: 6 },
                ibsNote: 'If dairy-sensitive, swap for coconut yogurt.',
                cutPhase: true,
            },
        ],
    },

    lunch: {
        time: '12:30 PM',
        note: 'Largest meal of the day — fuels afternoon energy',
        options: [
            {
                name: 'Chicken & Rice Bowl',
                ingredients: ['200g chicken breast', '170g basmati rice (cooked)', 'peppers', 'courgette', '1 tbsp olive oil', 'soy sauce'],
                macros: { cal: 620, protein: 50, carb: 58, fat: 17 },
                ibsNote: 'White rice is gentle on the gut. Low FODMAP.',
            },
            {
                name: 'Tuna Pasta',
                ingredients: ['2 tins tuna (in spring water)', '180g pasta (cooked)', 'sweetcorn', 'peppers', '1 tbsp light mayo', 'rocket'],
                macros: { cal: 610, protein: 48, carb: 56, fat: 14 },
                ibsNote: 'Tinned tuna is gentle on digestion. Mayo in small amounts is fine.',
            },
            {
                name: 'Chicken Noodle Stir-Fry',
                ingredients: ['200g chicken breast', '180g egg noodles (cooked)', 'peppers', 'courgette', 'ginger', '1 tbsp sesame oil', 'soy sauce'],
                macros: { cal: 600, protein: 46, carb: 54, fat: 16 },
                ibsNote: 'Ginger is a natural gut-soother.',
            },
            {
                name: 'Lean Beef & Potatoes',
                ingredients: ['180g lean beef mince', '230g potatoes', 'carrots', 'spinach', '1 tbsp olive oil'],
                macros: { cal: 620, protein: 46, carb: 54, fat: 19 },
                ibsNote: 'Red meat supports ferritin levels. Pair with Vitamin C (peppers) for absorption.',
            },
            {
                name: 'Prawn Fried Rice',
                ingredients: ['200g prawns', '170g basmati rice (cooked)', '2 eggs', 'spring onion (green part)', 'soy sauce', 'sesame oil'],
                macros: { cal: 580, protein: 48, carb: 52, fat: 14 },
                ibsNote: 'Use only the green part of spring onions (low FODMAP).',
            },
            // Cut-phase options (~400-450 kcal, 40g+ protein)
            {
                name: 'Chicken Salad',
                ingredients: ['200g chicken breast', 'mixed leaves', 'cucumber', 'tomato', '1/2 avocado', '1 tbsp olive oil', 'lemon juice'],
                macros: { cal: 430, protein: 45, carb: 10, fat: 22 },
                ibsNote: 'Low FODMAP. Avocado in half portions is gut-friendly.',
                cutPhase: true,
            },
            {
                name: 'Chicken Stir-Fry (No Rice)',
                ingredients: ['200g chicken breast', 'courgette', 'peppers', 'broccoli', 'ginger', '1 tbsp sesame oil', 'soy sauce'],
                macros: { cal: 380, protein: 44, carb: 14, fat: 16 },
                ibsNote: 'Ginger soothes the gut. Skip rice to keep calories in check.',
                cutPhase: true,
            },
            {
                name: 'Tuna & Avocado Salad',
                ingredients: ['2 tins tuna (in spring water)', 'mixed leaves', 'cucumber', '1/2 avocado', 'peppers', 'lemon dressing'],
                macros: { cal: 400, protein: 46, carb: 8, fat: 20 },
                ibsNote: 'Tinned tuna is gentle. Lemon dressing over mayo on a cut.',
                cutPhase: true,
            },
        ],
    },

    snack: {
        time: '3:30 PM',
        note: 'Anti-hypoglycemia snack — never skip this',
        options: [
            {
                name: 'Protein Shake + Banana',
                ingredients: ['1 scoop whey protein', '1 banana', '250ml oat milk'],
                macros: { cal: 320, protein: 32, carb: 38, fat: 6 },
            },
            {
                name: 'Rice Cakes & PB',
                ingredients: ['3 rice cakes', '2 tbsp peanut butter', 'drizzle honey'],
                macros: { cal: 340, protein: 12, carb: 40, fat: 15 },
            },
            {
                name: 'Boiled Eggs & Fruit',
                ingredients: ['2 boiled eggs', '1 banana', '15 almonds'],
                macros: { cal: 340, protein: 18, carb: 28, fat: 20 },
            },
            {
                name: 'Protein Bar + Fruit',
                ingredients: ['1 protein bar (~200 cal)', '1 banana'],
                macros: { cal: 310, protein: 22, carb: 38, fat: 8 },
                ibsNote: 'Check bar label — avoid sugar alcohols if IBS-sensitive.',
            },
            {
                name: 'Yogurt & Nuts',
                ingredients: ['200g Greek yogurt', '30g mixed nuts', 'drizzle honey'],
                macros: { cal: 340, protein: 24, carb: 22, fat: 18 },
                ibsNote: 'If dairy-sensitive, swap for coconut yogurt.',
            },
            // Cut-phase options (~150-200 kcal, 25g+ protein)
            {
                name: 'Protein Shake',
                ingredients: ['1 scoop whey protein', '250ml water'],
                macros: { cal: 120, protein: 25, carb: 3, fat: 2 },
                cutPhase: true,
            },
            {
                name: 'Cottage Cheese & Cucumber',
                ingredients: ['200g cottage cheese', 'cucumber slices', 'pinch salt & pepper'],
                macros: { cal: 180, protein: 24, carb: 6, fat: 6 },
                ibsNote: 'Cottage cheese is low FODMAP in small servings.',
                cutPhase: true,
            },
            {
                name: 'Greek Yogurt (Plain)',
                ingredients: ['150g Greek yogurt', 'squeeze lemon', 'pinch cinnamon'],
                macros: { cal: 130, protein: 15, carb: 8, fat: 5 },
                ibsNote: 'If dairy-sensitive, swap for coconut yogurt.',
                cutPhase: true,
            },
        ],
    },

    dinner: {
        time: '6:30 PM',
        note: '3+ hours before bed. No sugar. Supports deep sleep.',
        options: [
            {
                name: 'Grilled Chicken & Veg',
                ingredients: ['200g chicken thigh', 'roasted peppers', 'courgette', '180g sweet potato', '1 tbsp olive oil', 'herbs'],
                macros: { cal: 580, protein: 45, carb: 38, fat: 23 },
            },
            {
                name: 'Mild Chicken Curry',
                ingredients: ['200g chicken thigh', '160g basmati rice', 'light coconut milk', 'spinach', 'ginger', 'turmeric'],
                macros: { cal: 610, protein: 44, carb: 52, fat: 21 },
                ibsNote: 'Turmeric + ginger are anti-inflammatory and gut-friendly.',
            },
            {
                name: 'Prawn Stir-Fry',
                ingredients: ['200g prawns', '170g rice', 'courgette', 'peppers', 'soy sauce', '1 tbsp sesame oil', '1 egg'],
                macros: { cal: 550, protein: 48, carb: 52, fat: 13 },
            },
            {
                name: 'Chicken Ramen',
                ingredients: ['200g chicken thigh', '1 pack ramen noodles', '1 egg (soft boiled)', 'pak choi', 'spring onion (green part)', 'miso paste'],
                macros: { cal: 610, protein: 48, carb: 50, fat: 20 },
                ibsNote: 'Miso is fermented and gut-friendly. Use green part of spring onion only.',
            },
            {
                name: 'Tuna Rice Bowl',
                ingredients: ['2 tins tuna (in spring water)', '170g basmati rice (cooked)', 'sweetcorn', 'edamame', 'soy sauce', '1 tsp sesame oil', '1/4 avocado'],
                macros: { cal: 580, protein: 46, carb: 52, fat: 16 },
                ibsNote: 'Simple and easy to digest. Avocado adds healthy fats.',
            },
            // Cut-phase options (~400-500 kcal, 45g+ protein)
            {
                name: 'Grilled Chicken & Greens',
                ingredients: ['200g chicken breast', 'roasted broccoli', 'green beans', '1 tbsp olive oil', 'lemon', 'herbs'],
                macros: { cal: 400, protein: 48, carb: 12, fat: 18 },
                cutPhase: true,
            },
            {
                name: 'Salmon & Vegetables',
                ingredients: ['180g salmon fillet', 'roasted courgette', 'peppers', 'spinach', '1 tsp olive oil'],
                macros: { cal: 450, protein: 42, carb: 10, fat: 26 },
                ibsNote: 'Omega-3 from salmon is anti-inflammatory.',
                cutPhase: true,
            },
            {
                name: 'Turkey Mince & Veg',
                ingredients: ['200g turkey mince', 'courgette', 'peppers', 'spinach', 'garlic', '1 tbsp olive oil', 'herbs'],
                macros: { cal: 420, protein: 46, carb: 10, fat: 20 },
                ibsNote: 'Turkey is lean and gentle on digestion.',
                cutPhase: true,
            },
        ],
    },
};


// ── SUPPLEMENTS ──

const SUPPLEMENTS = [
    { name: 'Vitamin D', dose: '4,000 IU', timing: 'With breakfast', note: 'Take with fat for absorption. Level was 37 nmol/L — target 75+.', icon: '☀️' },
    { name: 'Iron (Ferrous Fumarate)', dose: '210mg', timing: 'With lunch (or on empty stomach)', note: 'Take with Vitamin C (orange juice or peppers). Avoid with tea/coffee.', icon: '💊' },
    { name: 'Magnesium Glycinate', dose: '400mg', timing: 'Before bed', note: 'Supports sleep quality and HRV recovery. Gentle on gut.', icon: '🌙' },
    { name: 'Creatine Monohydrate', dose: '5g', timing: 'Any time (with food)', note: 'Preserves muscle on a deficit. Expect 1-2 kg water weight initially — not fat.', icon: '💪' },
];


// ── MEAL SELECTION ──

function selectDailyMeals(workoutTypeKey, dateOverride, ouraData, intensity, journalEntry) {
    const je = normaliseJournalEntry(journalEntry);
    const targets = calculateDailyTargets(workoutTypeKey, ouraData, intensity, je);
    const doy = getDayOfYear(dateOverride);

    // Meal selection — prefer cut-phase options when on aggressive cut, IBS-friendly when gut issues
    const hasGutIssues = je && (je.symptoms || []).includes('gut_issues');
    const isOnCut = targets.deficit >= 900; // Aggressive cut = use cut-phase meals

    function pickMeal(mealType, offset) {
        const options = MEAL_TEMPLATES[mealType].options;

        // On aggressive cut: prefer cut-phase meals
        if (isOnCut) {
            const cutOptions = options.filter(m => m.cutPhase);
            if (cutOptions.length > 0) {
                if (hasGutIssues) {
                    const cutIbs = cutOptions.filter(m => m.ibsNote);
                    if (cutIbs.length > 0) return cutIbs[(doy + offset) % cutIbs.length];
                }
                return cutOptions[(doy + offset) % cutOptions.length];
            }
        }

        if (hasGutIssues) {
            // Sort IBS-noted meals first, then pick by rotation
            const ibsFriendly = options.filter(m => m.ibsNote);
            if (ibsFriendly.length > 0) {
                return ibsFriendly[(doy + offset) % ibsFriendly.length];
            }
        }
        return options[(doy + offset) % options.length];
    }

    const breakfast = pickMeal('breakfast', 0);
    const lunch = pickMeal('lunch', 1);
    const snack = pickMeal('snack', 2);
    const dinner = pickMeal('dinner', 3);

    // Pre/post workout
    let preWorkout = null;
    let postWorkout = null;

    if (workoutTypeKey !== 'rest_day' && workoutTypeKey !== 'yoga' && workoutTypeKey !== 'mobility') {
        preWorkout = {
            name: 'Pre-Workout Fuel',
            time: '30-60 min before',
            suggestion: 'Banana + rice cake with honey',
            macros: { cal: 150, protein: 3, carb: 30, fat: 2 },
            note: 'Quick carbs without gut distress.',
        };
        postWorkout = {
            name: 'Post-Workout Recovery',
            time: 'Within 30 min after',
            suggestion: 'Protein shake (whey + banana + water)',
            macros: { cal: 200, protein: 25, carb: 25, fat: 2 },
            note: 'Fast protein + carbs for muscle repair.',
        };
    }

    if (workoutTypeKey === 'football') {
        if (preWorkout) {
            preWorkout.suggestion = 'Banana + rice cake + honey — 60 min before kickoff';
            preWorkout.note = 'Keep it light. Avoid fiber and dairy pre-match.';
        }
        if (postWorkout) {
            postWorkout.suggestion = 'Protein shake + banana immediately. Full meal within 2 hours.';
        }
    }

    // Gut issues: simplify pre-workout fuel
    if (hasGutIssues && preWorkout) {
        preWorkout.suggestion = 'Plain rice cake + small banana — keep it very simple';
        preWorkout.note = 'Gut is flaring. Avoid anything heavy before exercise.';
    }

    // Nausea: simplify pre-workout
    if (je && (je.symptoms || []).includes('nausea') && preWorkout) {
        preWorkout.suggestion = 'Plain toast or a few crackers — only if tolerable';
        preWorkout.note = 'Don\'t force food. Skip pre-workout fuel if nauseous.';
    }

    // Sum macros
    const meals = [breakfast, lunch, snack, dinner];
    const totalMacros = meals.reduce((acc, m) => ({
        cal: acc.cal + m.macros.cal,
        protein: acc.protein + m.macros.protein,
        carb: acc.carb + m.macros.carb,
        fat: acc.fat + m.macros.fat,
    }), { cal: 0, protein: 0, carb: 0, fat: 0 });

    // Recovery notes based on Oura data
    const recoveryNotes = [];
    if (ouraData && ouraData.readinessScore > 0) {
        if (ouraData.readinessScore < 55) {
            recoveryNotes.push({ icon: '🔋', text: 'Body needs recovery — calories reduced, focus on protein + anti-inflammatory foods.' });
        }
        if (ouraData.sleepScore > 0 && ouraData.sleepScore < 60) {
            recoveryNotes.push({ icon: '💤', text: 'Low sleep → cravings likely. Stick to plan, extra fruit if hungry.' });
        }
        if (ouraData.stressLevel === 'stressful') {
            recoveryNotes.push({ icon: '😤', text: 'Stress elevated → gut may be sensitive. Keep meals simple today.' });
        }
        if (ouraData.readinessScore >= 85 && intensity === 'hard') {
            recoveryNotes.push({ icon: '🔥', text: 'High readiness — calories boosted. Fuel the effort today.' });
        }
    }

    // Journal-based recovery notes
    if (je) {
        const symptoms = je.symptoms || [];
        const feeling = je.feeling || 3;

        if (symptoms.includes('gut_issues')) {
            recoveryNotes.push({ icon: '🫃', text: 'IBS flare — meals adjusted for easier digestion. Eat slowly, smaller portions.' });
        }
        if (symptoms.includes('headache')) {
            recoveryNotes.push({ icon: '🤕', text: 'Stay hydrated. Caffeine can help or hurt; stick to your usual intake.' });
        }
        if (symptoms.includes('nausea')) {
            recoveryNotes.push({ icon: '🤢', text: 'Eat smaller, blander meals. Ginger tea can help. Don\'t force food.' });
        }
        if (symptoms.includes('dizziness')) {
            recoveryNotes.push({ icon: '😵', text: 'Eat regularly to maintain blood sugar. Sit down to eat.' });
        }
        if (feeling <= 2) {
            recoveryNotes.push({ icon: '💙', text: 'Go easy on yourself. Comfort food is fine, just keep protein up.' });
        }
    }

    return {
        targets,
        meals,
        mealTimes: [
            MEAL_TEMPLATES.breakfast,
            MEAL_TEMPLATES.lunch,
            MEAL_TEMPLATES.snack,
            MEAL_TEMPLATES.dinner,
        ],
        preWorkout,
        postWorkout,
        supplements: SUPPLEMENTS,
        totalMacros,
        recoveryNotes,
        hydration: {
            target: `${targets.waterL}L water`,
            note: ['football', 'running_easy', 'running_tempo', 'running_long'].includes(workoutTypeKey)
                ? 'Add 500ml extra on active days. Electrolytes if sweating > 45 min.'
                : 'Sip throughout the day. Avoid large volumes at once (IBS).',
        },
    };
}


// ─────────────────────────────────────────────
// 10. HOLIDAY MODE
// ─────────────────────────────────────────────

function isHoliday(dateStr) {
    const h = COACH_CONFIG.holiday;
    if (!h || !h.active) return false;
    const check = dateStr || getTodayStr();
    return check >= h.startDate && check <= h.endDate;
}

function getHolidayInfo(dateStr) {
    const h = COACH_CONFIG.holiday;
    const check = dateStr || getTodayStr();
    const daysIn = daysBetween(h.startDate, check) + 1;
    const totalDays = daysBetween(h.startDate, h.endDate) + 1;
    const daysLeft = totalDays - daysIn;
    return {
        location: h.location,
        daysIn,
        totalDays,
        daysLeft,
        startDate: h.startDate,
        endDate: h.endDate,
    };
}

function getHolidayNutrition(dateStr) {
    return {
        isHoliday: true,
        location: COACH_CONFIG.holiday.location,
        info: getHolidayInfo(dateStr),
        tips: [
            { icon: '💧', title: 'Stay Hydrated', detail: 'Dubai heat means you need 3L+ water daily. Carry a bottle everywhere.' },
            { icon: '🥩', title: 'Keep Protein Up', detail: 'Aim for a protein source with every meal — eggs, grilled meats, yoghurt. You don\'t need to count grams.' },
            { icon: '🍽️', title: 'Eat 3 Meals', detail: 'Don\'t skip meals — your hypoglycemia risk means regular eating is non-negotiable, especially breakfast.' },
            { icon: '🫄', title: 'IBS Awareness', detail: 'New foods + travel stress can flare IBS. Eat slowly, avoid massive portions, stay hydrated.' },
            { icon: '🍷', title: 'Alcohol', detail: 'If drinking, alternate with water. Alcohol dehydrates fast in the heat and tanks HRV.' },
            { icon: '☀️', title: 'Vitamin D', detail: 'You\'re getting natural sun — still take your supplement but don\'t stress about it.' },
            { icon: '🧲', title: 'Iron', detail: 'Keep taking your iron supplement with a vitamin C source. Easy to forget on holiday.' },
            { icon: '😴', title: 'Sleep', detail: 'Take magnesium before bed as usual. Jet lag + late nights will mess with your Oura scores — that\'s fine.' },
        ],
        supplements: SUPPLEMENTS,
        mindset: 'Enjoy your holiday. The goal is rest and recovery, not optimization. Eat well, stay hydrated, walk around, and don\'t open MyFitnessPal.',
    };
}

function getHolidayWorkout(dateStr) {
    const info = getHolidayInfo(dateStr);
    return {
        isHoliday: true,
        location: COACH_CONFIG.holiday.location,
        info,
        suggestions: [
            { icon: '🚶', name: 'Walk & Explore', detail: 'Walk around the city, malls, beach. Aim for 8,000+ steps through natural exploration.' },
            { icon: '🏊', name: 'Hotel Pool / Beach', detail: 'Swimming is great active recovery. Even just floating counts.' },
            { icon: '🧘', name: 'Morning Stretch', detail: '10 min gentle stretch when you wake up. Nothing intense — just get the body moving.' },
            { icon: '🏋️', name: 'Hotel Gym (Optional)', detail: 'If you feel like it, a light 20-min session. But zero pressure — you\'re on holiday.' },
        ],
        avoid: [
            'No HIIT or intense cardio in extreme heat',
            'No HIIT or intense cardio in the heat',
            'No pressure to "make up" sessions when you\'re back',
        ],
        mindset: 'Movement should feel like fun, not a workout. If you\'re exploring Dubai, you\'re already moving enough.',
    };
}


// ─────────────────────────────────────────────
// 11. RECOVERY STATUS
// ─────────────────────────────────────────────

function buildRecoveryStatus(ouraData, phase) {
    const today = getTodayStr();
    const daysSinceConcussion = daysBetween(COACH_CONFIG.events.concussionDate, today);
    const daysSinceAntibioticsStart = daysBetween(COACH_CONFIG.events.antibioticsStart, today);
    const daysSinceAntibioticsEnd = daysBetween(COACH_CONFIG.events.antibioticsEnd, today);
    const antibioticsDone = daysSinceAntibioticsEnd >= 0;

    const hrvGap = COACH_CONFIG.baselines.hrvBalance - (ouraData.hrvBalance || 0);
    const deepSleepMin = Math.round((ouraData.deepSleepSeconds || 0) / 60);
    const totalSleepHrs = Math.round(((ouraData.totalSleepSeconds || 0) / 3600) * 10) / 10;
    const sleepDebt = totalSleepHrs < COACH_CONFIG.baselines.totalSleepHours
        ? Math.round((COACH_CONFIG.baselines.totalSleepHours - totalSleepHrs) * 10) / 10
        : 0;

    // Concussion resolved as of Mar 3, 2026. Jaw issue is the active concern.
    const concussionResolved = COACH_CONFIG.events.concussionResolved;

    const milestones = [
        {
            label: 'Antibiotics completed',
            done: antibioticsDone,
            detail: antibioticsDone ? `Finished ${daysSinceAntibioticsEnd} days ago` : `Day ${daysSinceAntibioticsStart} of course`,
        },
        {
            label: 'HRV Balance healthy',
            done: ouraData.hrvBalance >= 80,
            detail: ouraData.hrvBalance > 0 ? `Currently ${ouraData.hrvBalance}` : 'No data',
        },
        {
            label: 'Temp deviation normalized',
            done: Math.abs(ouraData.tempDeviation || 0) < 15,
            detail: `${ouraData.tempDeviation || 'N/A'}`,
        },
        {
            label: 'Readiness consistently 75+',
            done: ouraData.readinessScore >= 75,
            detail: `Currently ${ouraData.readinessScore || 'N/A'}`,
        },
        {
            label: 'Concussion resolved',
            done: concussionResolved,
            detail: concussionResolved ? 'Resolved — lingering symptoms attributed to jaw issue' : `Day ${daysSinceConcussion} post-impact`,
        },
        {
            label: 'Returned to football',
            done: concussionResolved,
            detail: concussionResolved ? 'Playing 2x/week' : 'Pending clearance',
        },
    ];

    const completedCount = milestones.filter(m => m.done).length;

    return {
        phase,
        daysSinceConcussion,
        daysSinceAntibioticsStart,
        antibioticsDone,
        hrvGap: hrvGap > 0 ? hrvGap : 0,
        sleepDebt,
        deepSleepMin,
        totalSleepHrs,
        milestones,
        completedCount,
        totalMilestones: milestones.length,
        overallPct: Math.round((completedCount / milestones.length) * 100),
    };
}


// ─────────────────────────────────────────────
// 11. CONDITION NOTES (for nutrition section)
// ─────────────────────────────────────────────

const CONDITION_TIPS = [
    {
        condition: 'IBS',
        icon: '🫄',
        tip: 'Your IBS is stress-driven. Focus on regular meal timing and stress management over food restriction. Eat 4 meals at consistent times.',
    },
    {
        condition: 'Hypoglycemia Risk',
        icon: '⚡',
        tip: 'Blood glucose dropped to 2.6 mmol/L previously. Never skip meals. Eat every 4-5 hours. Always carry a banana.',
    },
    {
        condition: 'Vitamin D',
        icon: '☀️',
        tip: 'Level was 37 nmol/L (insufficient). Take 4,000 IU daily with a fat-containing meal. Get 15-20 min sunlight when possible.',
    },
    {
        condition: 'Cortisol',
        icon: '🧠',
        tip: 'Cortisol at 85th percentile. Prioritize breathwork, walking in nature, consistent sleep. Avoid overtraining when under-recovered.',
    },
];


// ─────────────────────────────────────────────
// 12. WEEKLY SCHEDULE BUILDER
// ─────────────────────────────────────────────

function buildWeeklySchedule(phase, ouraData) {
    const schedule = PHASE_SCHEDULES[phase.id] || PHASE_SCHEDULES.heal;
    const weekDates = getWeekDates();
    const todayStr = getTodayStr();

    return weekDates.map((date, idx) => {
        const dateStr = getDateStr(date);
        const typeKey = schedule[idx];
        const template = WORKOUT_LIBRARY[typeKey];
        const isToday = dateStr === todayStr;
        const isPast = date < new Date(todayStr + 'T00:00:00');

        // For today, use actual intensity. For future, estimate moderate. For past, show as completed.
        let intensity = 'moderate';
        if (isToday) {
            intensity = determineIntensity(ouraData, phase);
        } else if (isPast) {
            intensity = 'moderate'; // We don't have past Oura data per-day in this view
        }

        return {
            dayName: DAY_NAMES[idx],
            date: dateStr,
            dateShort: date.getDate(),
            typeKey,
            name: template ? template.name : typeKey,
            icon: template ? template.icon : '❓',
            intensity: isToday ? intensity : null,
            isToday,
            isPast,
        };
    });
}


// ─────────────────────────────────────────────
// 13. JOURNAL DATA LAYER
// ─────────────────────────────────────────────

/**
 * Normalise a journal entry's symptoms into a flat array of active symptom keys.
 * The UI stores symptoms as {headache: true, dizziness: false, ...} but the
 * engine functions expect an array like ['headache', 'nausea'].
 * Also normalises 'overallFeeling' → 'feeling' for consistency.
 */
function normaliseJournalEntry(entry) {
    if (!entry) return null;
    const out = { ...entry };

    // Key mapping: UI uses camelCase, engine uses snake_case
    const keyMap = {
        brainFog: 'brain_fog',
        lightSensitivity: 'light_sensitivity',
        gutIssues: 'gut_issues',
    };

    // Symptoms: object → array of normalised keys
    if (entry.symptoms && !Array.isArray(entry.symptoms)) {
        out.symptoms = Object.keys(entry.symptoms)
            .filter(k => entry.symptoms[k])
            .map(k => keyMap[k] || k);
    } else if (Array.isArray(entry.symptoms)) {
        out.symptoms = entry.symptoms.map(k => keyMap[k] || k);
    } else {
        out.symptoms = [];
    }

    // Feeling: overallFeeling → feeling
    if (entry.overallFeeling !== undefined && entry.feeling === undefined) {
        out.feeling = entry.overallFeeling;
    }

    return out;
}

let _journalData = {};

async function loadJournalData() {
    try {
        const res = await fetch('/api/journal');
        if (res.ok) {
            _journalData = await res.json();
        }
    } catch (e) {
        console.warn('Could not load journal from server, trying localStorage');
        try {
            _journalData = JSON.parse(localStorage.getItem('oura-journal') || '{}');
        } catch (e2) {
            _journalData = {};
        }
    }
    return _journalData;
}

async function saveJournalEntry(dateStr, entry) {
    _journalData[dateStr] = entry;

    // Save to server
    try {
        await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateStr, entry }),
        });
    } catch (e) {
        console.warn('Server save failed, using localStorage only');
    }

    // Always save to localStorage as backup
    localStorage.setItem('oura-journal', JSON.stringify(_journalData));
}

function getJournalEntry(dateStr) {
    return _journalData[dateStr] || null;
}

function getRecentJournalEntries(count) {
    return Object.entries(_journalData)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, count)
        .map(([date, entry]) => ({ date, ...entry }));
}

/**
 * Count consecutive symptom-free days walking backwards from dateStr.
 * Stops at the first day with a concussion symptom OR no journal entry.
 */
function getSymptomFreeDays(dateStr) {
    const startDate = dateStr || getTodayStr();
    let count = 0;
    let checkDate = new Date(startDate + 'T12:00:00'); // noon to avoid timezone drift

    while (true) {
        const ds = getDateStr(checkDate);
        const entry = _journalData[ds];
        if (!entry) break; // No entry — can't confirm symptom-free
        const s = entry.symptoms || {};
        if (s.headache || s.dizziness || s.brainFog || s.nausea || s.lightSensitivity) break;
        count++;
        checkDate.setDate(checkDate.getDate() - 1);
    }
    return count;
}


// ─────────────────────────────────────────────
// 14. JOURNAL RECOMMENDATION ENGINE
// ─────────────────────────────────────────────

/**
 * Analyse journal entry against current workout/nutrition and build a recommendation.
 * Returns null if no symptoms warrant changes.
 * Does NOT apply changes — just builds the recommendation text.
 */
function buildJournalRecommendation(journalEntry, currentWorkout, ouraData, phase) {
    if (!journalEntry) return null;
    const je = normaliseJournalEntry(journalEntry);

    const symptoms = je.symptoms || [];
    const feeling = je.feeling || 3;
    const workoutChanges = [];
    const nutritionChanges = [];

    // ── Workout analysis ──

    // Check what intensity would be WITH journal applied
    const adjustedIntensity = determineIntensity(ouraData, phase, je);
    const currentIntensity = currentWorkout ? currentWorkout.intensity : adjustedIntensity;

    if (feeling <= 1) {
        workoutChanges.push(`Intensity: ${currentIntensity} → rest`);
        workoutChanges.push('Feeling rough — take a full rest day');
    } else if (symptoms.includes('dizziness')) {
        if (currentIntensity !== 'easy') {
            workoutChanges.push(`Intensity: ${currentIntensity} → easy`);
        }
        // Check for activity swap
        if (currentWorkout) {
            const schedule = PHASE_SCHEDULES[phase.id] || PHASE_SCHEDULES.heal;
            const dayIdx = getDayOfWeekMon0(new Date());
            const plannedType = schedule[dayIdx];
            if (['football', 'running_easy', 'running_tempo', 'running_long'].includes(plannedType)) {
                workoutChanges.push(`${WORKOUT_LIBRARY[plannedType].name} → Walking (balance issues make ${['football'].includes(plannedType) ? 'football' : 'running'} unsafe)`);
            }
        }
        workoutChanges.push('Dizziness reported — may be jaw-related. Taking it easier.');
    } else {
        // Count symptoms (may be jaw-related, not concussion)
        const warnSymptoms = symptoms.filter(s =>
            ['headache', 'dizziness', 'brain_fog', 'light_sensitivity', 'nausea'].includes(s)
        );
        if (warnSymptoms.length >= 3) {
            if (currentIntensity !== 'easy') {
                workoutChanges.push(`Intensity: ${currentIntensity} → easy`);
            }
            workoutChanges.push('Multiple symptoms — take it easy');
        } else if (symptoms.includes('headache')) {
            if (adjustedIntensity !== currentIntensity) {
                workoutChanges.push(`Intensity: ${currentIntensity} → ${adjustedIntensity}`);
            }
            workoutChanges.push('Headache — lighter intensity recommended');
        } else if (symptoms.includes('nausea')) {
            if (adjustedIntensity !== currentIntensity) {
                workoutChanges.push(`Intensity: ${currentIntensity} → ${adjustedIntensity}`);
            }
            workoutChanges.push('Nausea — lighter intensity recommended');
        }
    }

    if (feeling <= 2 && feeling > 1 && workoutChanges.length === 0) {
        if (adjustedIntensity !== currentIntensity) {
            workoutChanges.push(`Intensity: ${currentIntensity} → ${adjustedIntensity}`);
        }
        workoutChanges.push('Feeling low — dialling it back');
    }

    // ── Nutrition analysis ──

    if (symptoms.includes('gut_issues')) {
        nutritionChanges.push('Meals adjusted for IBS — easier digestion options');
        nutritionChanges.push('Calories reduced ~100');
    }
    if (symptoms.includes('nausea')) {
        nutritionChanges.push('Smaller, simpler meals');
        nutritionChanges.push('Don\'t force food — eat what you can');
    }
    if (symptoms.includes('headache')) {
        nutritionChanges.push('Hydration note added');
    }
    if (symptoms.includes('dizziness')) {
        nutritionChanges.push('Blood sugar note — eat regularly');
    }
    if (feeling <= 2) {
        nutritionChanges.push('Comfort-focused approach, keeping protein up');
    }

    // If nothing to change, return null
    if (workoutChanges.length === 0 && nutritionChanges.length === 0) return null;

    // Build summary text
    const summaryParts = [];
    if (symptoms.length > 0) {
        const symptomNames = symptoms.map(s => {
            const map = {
                headache: 'a headache', dizziness: 'dizziness', brain_fog: 'brain fog',
                light_sensitivity: 'light sensitivity', nausea: 'nausea',
                gut_issues: 'gut issues',
            };
            return map[s] || s;
        });
        summaryParts.push(`You reported ${symptomNames.join(' and ')}`);
    }
    if (feeling <= 2) {
        summaryParts.push(`you're feeling ${feeling}/5`);
    }

    let summary = summaryParts.join(' and ');
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);

    if (workoutChanges.length > 0 && nutritionChanges.length > 0) {
        summary += ' — I\'d suggest adjusting your workout and meals today.';
    } else if (workoutChanges.length > 0) {
        summary += ' — I\'d suggest adjusting your workout today.';
    } else {
        summary += ' — I\'d suggest adjusting your meals today.';
    }

    return {
        hasChanges: true,
        summary,
        workoutChanges,
        nutritionChanges,
        journalEntry,
    };
}


// ─────────────────────────────────────────────
// 15. WEEKLY GROCERY LIST
// ─────────────────────────────────────────────

// Category mapping — item name → category
const GROCERY_CATEGORIES = {
    // Protein
    'chicken breast': 'Protein', 'chicken thigh': 'Protein', 'lean beef mince': 'Protein',
    'prawns': 'Protein', 'tuna (in spring water)': 'Protein', 'eggs': 'Protein',
    'eggs (scrambled)': 'Protein', 'egg (soft boiled)': 'Protein', 'boiled eggs': 'Protein',

    // Dairy & Alt
    'greek yogurt': 'Dairy & Alt', 'oat milk': 'Dairy & Alt', 'whey protein': 'Protein',
    'scoop whey protein': 'Dairy & Alt', 'scoop whey': 'Dairy & Alt',
    'light coconut milk': 'Dairy & Alt', 'light mayo': 'Dairy & Alt',
    'coconut yogurt': 'Dairy & Alt',

    // Grains & Carbs
    'oats': 'Grains & Carbs', 'basmati rice (cooked)': 'Grains & Carbs',
    'pasta (cooked)': 'Grains & Carbs', 'egg noodles (cooked)': 'Grains & Carbs',
    'bread': 'Grains & Carbs', 'rice cakes': 'Grains & Carbs',
    'ramen noodles': 'Grains & Carbs', 'pack ramen noodles': 'Grains & Carbs',
    'granola': 'Grains & Carbs', 'potatoes': 'Grains & Carbs', 'sweet potato': 'Grains & Carbs',

    // Fruit
    'banana': 'Fruit', 'frozen berries': 'Fruit', 'avocado': 'Fruit',

    // Vegetables
    'peppers': 'Vegetables', 'courgette': 'Vegetables', 'spinach': 'Vegetables',
    'carrots': 'Vegetables', 'pak choi': 'Vegetables', 'spring onion (green part)': 'Vegetables',
    'rocket': 'Vegetables', 'sweetcorn': 'Vegetables', 'edamame': 'Vegetables',

    // Pantry
    'peanut butter': 'Pantry', 'almond butter': 'Pantry', 'olive oil': 'Pantry',
    'sesame oil': 'Pantry', 'soy sauce': 'Pantry', 'honey': 'Pantry',
    'miso paste': 'Pantry', 'chia seeds': 'Pantry', 'mixed nuts': 'Pantry',
    'herbs': 'Pantry', 'ginger': 'Pantry', 'turmeric': 'Pantry',
    'protein bar (~200 cal)': 'Pantry', 'almonds': 'Pantry',
};

// Parse an ingredient string like "200g chicken breast" into { qty, unit, item }
function parseIngredient(str) {
    const s = str.trim();

    // Pattern: "200g chicken breast", "1 banana", "2 tbsp peanut butter", "handful spinach"
    // Try: number + optional unit + item
    const match = s.match(/^(\d+\.?\d*)\s*(g|ml|tbsp|tsp|slices|tins|pack|scoop|scoops|L|l)?\s+(.+)$/i);
    if (match) {
        return {
            qty: parseFloat(match[1]),
            unit: match[2] ? match[2].toLowerCase() : 'count',
            item: match[3].trim().toLowerCase(),
        };
    }

    // "handful spinach", "drizzle honey"
    const vagueMatch = s.match(/^(handful|drizzle)\s+(.+)$/i);
    if (vagueMatch) {
        return {
            qty: 1,
            unit: vagueMatch[1].toLowerCase(),
            item: vagueMatch[2].trim().toLowerCase(),
        };
    }

    // Fraction: "1/2 avocado"
    const fracMatch = s.match(/^(\d+)\/(\d+)\s+(.+)$/);
    if (fracMatch) {
        return {
            qty: parseFloat(fracMatch[1]) / parseFloat(fracMatch[2]),
            unit: 'count',
            item: fracMatch[3].trim().toLowerCase(),
        };
    }

    // Fallback — treat whole thing as 1 count
    return { qty: 1, unit: 'count', item: s.toLowerCase() };
}

// Normalise item names to merge equivalent ingredients
function normaliseItemName(item) {
    const map = {
        'eggs (scrambled)': 'eggs',
        'egg (soft boiled)': 'eggs',
        'egg': 'eggs',
        'boiled eggs': 'eggs',
        'scoop whey protein': 'whey protein',
        'scoop whey': 'whey protein',
        'scoop whey (shake on side)': 'whey protein',
        'whey (shake on side)': 'whey protein',
        'roasted peppers': 'peppers',
        'whey': 'whey protein',
        'pack ramen noodles': 'ramen noodles',
        'basmati rice (cooked)': 'basmati rice',
        'rice': 'basmati rice',
        'pasta (cooked)': 'pasta',
        'egg noodles (cooked)': 'egg noodles',
        'tuna (in spring water)': 'tinned tuna',
        'tins tuna (in spring water)': 'tinned tuna',
        'slices bread': 'bread',
        'protein bar (~200 cal)': 'protein bar',
    };
    return map[item] || item;
}

// Normalise units for aggregation — convert scoop → count for whey, tins → count for tuna, etc.
function normaliseUnit(unit, item) {
    if (unit === 'scoops') return 'scoop';
    return unit;
}

function getCategoryForItem(rawItem) {
    // Try direct match first
    if (GROCERY_CATEGORIES[rawItem]) return GROCERY_CATEGORIES[rawItem];

    // Try normalised name
    const norm = normaliseItemName(rawItem);
    if (GROCERY_CATEGORIES[norm]) return GROCERY_CATEGORIES[norm];

    // Fuzzy: check if any key is contained in the item
    for (const [key, cat] of Object.entries(GROCERY_CATEGORIES)) {
        if (rawItem.includes(key) || key.includes(rawItem)) return cat;
    }

    return 'Other';
}

function generateWeeklyGroceryList(startDate) {
    const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();

    // Find the Monday of the week containing startDate
    const dayOfWeek = start.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(start);
    monday.setDate(monday.getDate() + mondayOffset);

    const ingredientMap = {}; // key: "item|unit" → { item, qty, unit, category }
    const mealSummary = [];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        const dateStr = getDateStr(d);

        // Check holiday
        if (isHoliday(dateStr)) {
            mealSummary.push({
                date: dateStr,
                day: dayNames[d.getDay()],
                meals: ['🌴 Holiday — no meal plan'],
                isHoliday: true,
            });
            continue;
        }

        const doy = getDayOfYear(d);

        // Select meals using the same rotation as selectDailyMeals
        const breakfast = MEAL_TEMPLATES.breakfast.options[(doy + 0) % MEAL_TEMPLATES.breakfast.options.length];
        const lunch = MEAL_TEMPLATES.lunch.options[(doy + 1) % MEAL_TEMPLATES.lunch.options.length];
        const snack = MEAL_TEMPLATES.snack.options[(doy + 2) % MEAL_TEMPLATES.snack.options.length];
        const dinner = MEAL_TEMPLATES.dinner.options[(doy + 3) % MEAL_TEMPLATES.dinner.options.length];

        const dayMeals = [breakfast, lunch, snack, dinner];

        mealSummary.push({
            date: dateStr,
            day: dayNames[d.getDay()],
            meals: dayMeals.map(m => m.name),
        });

        // Collect ingredients from all 4 meals
        for (const meal of dayMeals) {
            for (const ingStr of meal.ingredients) {
                const parsed = parseIngredient(ingStr);
                const normItem = normaliseItemName(parsed.item);
                const normUnit = normaliseUnit(parsed.unit, normItem);
                const key = `${normItem}|${normUnit}`;

                if (ingredientMap[key]) {
                    ingredientMap[key].qty += parsed.qty;
                } else {
                    ingredientMap[key] = {
                        item: normItem,
                        qty: parsed.qty,
                        unit: normUnit,
                        category: getCategoryForItem(parsed.item),
                    };
                }
            }
        }

        // Pre-workout fuel for non-rest days (approximate: add banana + rice cake + honey)
        // We don't know the exact workout type without Oura data, so add for weekdays as a baseline
        const dayOfWeekMon0 = getDayOfWeekMon0(d);
        if (dayOfWeekMon0 < 5) { // Mon-Fri: likely workout days
            const preFuel = ['1 banana', '1 rice cakes', 'drizzle honey'];
            for (const ingStr of preFuel) {
                const parsed = parseIngredient(ingStr);
                const normItem = normaliseItemName(parsed.item);
                const normUnit = normaliseUnit(parsed.unit, normItem);
                const key = `${normItem}|${normUnit}`;
                if (ingredientMap[key]) {
                    ingredientMap[key].qty += parsed.qty;
                } else {
                    ingredientMap[key] = {
                        item: normItem,
                        qty: parsed.qty,
                        unit: normUnit,
                        category: getCategoryForItem(parsed.item),
                    };
                }
            }
        }
    }

    // Check if entire week is holiday
    const allHoliday = mealSummary.every(d => d.isHoliday);
    if (allHoliday) {
        return {
            weekStart: getDateStr(monday),
            weekEnd: getDateStr(new Date(monday.getTime() + 6 * 86400000)),
            isHoliday: true,
            holidayLocation: COACH_CONFIG.holiday.location,
            categories: {},
            mealSummary,
            totalMeals: 0,
        };
    }

    // Organise into categories
    const categoryOrder = ['Protein', 'Dairy & Alt', 'Grains & Carbs', 'Fruit', 'Vegetables', 'Pantry', 'Other'];
    const categories = {};
    for (const cat of categoryOrder) {
        categories[cat] = [];
    }

    for (const entry of Object.values(ingredientMap)) {
        const cat = entry.category;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({
            item: entry.item,
            qty: Math.round(entry.qty * 10) / 10, // round to 1 decimal
            unit: entry.unit,
        });
    }

    // Sort items within each category alphabetically
    for (const cat of Object.keys(categories)) {
        categories[cat].sort((a, b) => a.item.localeCompare(b.item));
    }

    // Remove empty categories
    for (const cat of Object.keys(categories)) {
        if (categories[cat].length === 0) delete categories[cat];
    }

    const nonHolidayDays = mealSummary.filter(d => !d.isHoliday).length;

    return {
        weekStart: getDateStr(monday),
        weekEnd: getDateStr(new Date(monday.getTime() + 6 * 86400000)),
        isHoliday: false,
        categories,
        mealSummary,
        totalMeals: nonHolidayDays * 4,
    };
}

// Format a grocery item for display: "Chicken breast — 800g" or "Bananas — 5"
function formatGroceryItem(entry) {
    const name = entry.item.charAt(0).toUpperCase() + entry.item.slice(1);
    if (entry.unit === 'count') {
        return `${name} — ${entry.qty}`;
    }
    if (entry.unit === 'handful' || entry.unit === 'drizzle') {
        return `${name} — ${entry.qty}× ${entry.unit}`;
    }
    // Convert large ml to L
    if (entry.unit === 'ml' && entry.qty >= 1000) {
        return `${name} — ${(entry.qty / 1000).toFixed(1)}L`;
    }
    // Units that read better with a space: "6 tins", "4 slices", "3 scoop"
    const spacedUnits = ['tins', 'slices', 'pack', 'scoop', 'scoops', 'tbsp', 'tsp'];
    if (spacedUnits.includes(entry.unit)) {
        return `${name} — ${entry.qty} ${entry.unit}`;
    }
    return `${name} — ${entry.qty}${entry.unit}`;
}


// ─────────────────────────────────────────────
// WEIGHT LOG
// ─────────────────────────────────────────────

let _weightData = {};

async function loadWeightData() {
    try {
        const res = await fetch('/api/weight-log');
        if (res.ok) {
            _weightData = await res.json();
        }
    } catch (e) {
        console.warn('Weight log: server unavailable, trying localStorage');
        try {
            _weightData = JSON.parse(localStorage.getItem('oura-weight-log') || '{}');
        } catch { _weightData = {}; }
    }
    updateCurrentWeight();
    return _weightData;
}

async function saveWeightEntry(dateStr, entry) {
    _weightData[dateStr] = entry;
    localStorage.setItem('oura-weight-log', JSON.stringify(_weightData));
    try {
        await fetch('/api/weight-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: dateStr, entry }),
        });
    } catch (e) {
        console.warn('Weight log: server save failed, localStorage only');
    }
    updateCurrentWeight();
}

function getLatestWeight() {
    const dates = Object.keys(_weightData).sort();
    if (dates.length === 0) return null;
    const latest = dates[dates.length - 1];
    return { date: latest, ..._weightData[latest] };
}

function getWeightHistory() {
    return Object.entries(_weightData)
        .map(([date, entry]) => ({ date, ...entry }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function updateCurrentWeight() {
    const latest = getLatestWeight();
    if (latest) {
        COACH_CONFIG.user.currentWeightKg = latest.weightKg;
    }
}

function getWeightProgress() {
    const history = getWeightHistory();
    const goalWeight = COACH_CONFIG.user.goalWeightKg;

    if (history.length === 0) {
        const cw = COACH_CONFIG.user.currentWeightKg;
        return {
            startWeight: cw, currentWeight: cw, goalWeight,
            lostKg: 0, toGoKg: +(cw - goalWeight).toFixed(1),
            progressPct: 0, weeklyAvgRate: 0,
            daysSinceLastWeighIn: null, entries: [],
        };
    }

    const startWeight = COACH_CONFIG.user.startWeightKg || history[0].weightKg;
    const currentWeight = history[history.length - 1].weightKg;
    const lostKg = +((startWeight - currentWeight).toFixed(1));
    const totalToLose = startWeight - goalWeight;
    const progressPct = totalToLose > 0
        ? Math.max(0, Math.min(100, Math.round((lostKg / totalToLose) * 100)))
        : 0;

    const firstDate = new Date(history[0].date + 'T00:00:00');
    const lastDate = new Date(history[history.length - 1].date + 'T00:00:00');
    const weeksElapsed = Math.max(1, (lastDate - firstDate) / (7 * 86400000));
    const weeklyAvgRate = +(lostKg / weeksElapsed).toFixed(2);

    const today = new Date();
    const lastWeighIn = new Date(history[history.length - 1].date + 'T00:00:00');
    const daysSinceLastWeighIn = Math.floor((today - lastWeighIn) / 86400000);

    return {
        startWeight, currentWeight, goalWeight,
        lostKg, toGoKg: +((currentWeight - goalWeight).toFixed(1)),
        progressPct, weeklyAvgRate, daysSinceLastWeighIn,
        entries: history,
    };
}

// ─────────────────────────────────────────────
// EXPORTS (for use in daily-coach.html)
// ─────────────────────────────────────────────

// All functions and constants are global (no module system needed for a single HTML page).
// The HTML page will call these directly.
