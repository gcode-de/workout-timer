function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatLoad(profile, load) {
    if (load == null) return 'Gewicht festlegen';
    if (load === 0 && profile.zeroLabel) return profile.zeroLabel;
    return `${formatNumber(load)} ${profile.unit ?? 'kg'}`.trim();
}

export function sessionsForExercise(history, trackingId, { excludeSessionId = null } = {}) {
    const sessions = new Map();

    for (const entry of history) {
        if (entry.trackingId !== trackingId || entry.sessionId === excludeSessionId) continue;
        if (!sessions.has(entry.sessionId)) sessions.set(entry.sessionId, []);
        sessions.get(entry.sessionId).push(entry);
    }

    return [...sessions.values()]
        .map((entries) => entries.sort((a, b) => a.set - b.set))
        .sort((a, b) => Date.parse(b[0]?.completedAt ?? 0) - Date.parse(a[0]?.completedAt ?? 0));
}

function completedSession(session, expectedSets) {
    return session.length >= expectedSets;
}

function sessionFailed(session, profile) {
    return session.some((entry) => entry.reps < profile.minReps);
}

function reducedLoad(load, increment) {
    if (!finiteNumber(load) || load <= 0) return load;
    return Math.max(0, Number((load - increment).toFixed(2)));
}

function loadRecommendation(profile, recentSessions, expectedSets) {
    const latest = recentSessions[0];
    const fallbackLoad = finiteNumber(profile.initialLoad) ? profile.initialLoad : null;
    const fallbackReps = profile.initialReps ?? profile.minReps;

    if (!latest?.length) {
        return {
            action: 'start',
            load: fallbackLoad,
            reps: fallbackReps,
            text: `${formatLoad(profile, fallbackLoad)} · ${expectedSets} × ${fallbackReps}`
        };
    }

    const load = finiteNumber(latest[0].load) ? latest[0].load : fallbackLoad;
    const minCompletedReps = Math.min(...latest.map((entry) => entry.reps));
    if (!completedSession(latest, expectedSets)) {
        return {
            action: 'repeat',
            load,
            reps: Math.max(profile.minReps, minCompletedReps),
            text: `${formatLoad(profile, load)} · ${expectedSets} × ${Math.max(profile.minReps, minCompletedReps)}`
        };
    }
    const readyToIncrease = completedSession(latest, expectedSets)
        && latest.every((entry) => entry.reps >= profile.maxReps && entry.rir >= 1);
    const twoFailures = recentSessions.slice(0, 2).length === 2
        && recentSessions.slice(0, 2).every((session) => completedSession(session, expectedSets) && sessionFailed(session, profile));

    if (readyToIncrease) {
        if (load == null) {
            return {
                action: 'set-load',
                load: null,
                reps: profile.minReps,
                text: `Zusatzgewicht wählen · ${expectedSets} × ${profile.minReps}`
            };
        }

        const nextLoad = Number((load + profile.increment).toFixed(2));
        return {
            action: 'increase-load',
            load: nextLoad,
            reps: profile.minReps,
            text: `${formatLoad(profile, nextLoad)} · ${expectedSets} × ${profile.minReps}`
        };
    }

    if (twoFailures && finiteNumber(load) && load > 0) {
        const nextLoad = reducedLoad(load, profile.increment);
        return {
            action: 'reduce-load',
            load: nextLoad,
            reps: profile.minReps,
            text: `${formatLoad(profile, nextLoad)} · ${expectedSets} × ${profile.minReps}`
        };
    }

    const nextReps = Math.min(profile.maxReps, Math.max(profile.minReps, minCompletedReps + 1));
    return {
        action: 'add-rep',
        load,
        reps: nextReps,
        text: `${formatLoad(profile, load)} · ${expectedSets} × ${nextReps}`
    };
}

function variantRecommendation(profile, recentSessions, expectedSets) {
    const latest = recentSessions[0];
    const variants = profile.variants ?? [];
    const fallbackVariant = profile.initialVariant ?? variants[0] ?? 'Aktuelle Variante';
    const fallbackReps = profile.initialReps ?? profile.minReps;

    if (!latest?.length) {
        return {
            action: 'start',
            variant: fallbackVariant,
            reps: fallbackReps,
            text: `${fallbackVariant} · ${expectedSets} × ${fallbackReps}`
        };
    }

    const variant = latest[0].variant || fallbackVariant;
    const index = Math.max(0, variants.indexOf(variant));
    const minCompletedReps = Math.min(...latest.map((entry) => entry.reps));
    if (!completedSession(latest, expectedSets)) {
        return {
            action: 'repeat',
            variant,
            reps: Math.max(profile.minReps, minCompletedReps),
            text: `${variant} · ${expectedSets} × ${Math.max(profile.minReps, minCompletedReps)}`
        };
    }
    const readyToIncrease = completedSession(latest, expectedSets)
        && latest.every((entry) => entry.reps >= profile.maxReps && entry.rir >= 1);

    if (readyToIncrease && index < variants.length - 1) {
        const nextVariant = variants[index + 1];
        return {
            action: 'increase-variant',
            variant: nextVariant,
            reps: profile.minReps,
            text: `${nextVariant} · ${expectedSets} × ${profile.minReps}`
        };
    }

    if (readyToIncrease) {
        return {
            action: 'add-load',
            variant,
            reps: profile.maxReps,
            text: `${variant} · Zusatzgewicht erwägen`
        };
    }

    const nextReps = Math.min(profile.maxReps, Math.max(profile.minReps, minCompletedReps + 1));
    return {
        action: 'add-rep',
        variant,
        reps: nextReps,
        text: `${variant} · ${expectedSets} × ${nextReps}`
    };
}

export function recommendProgression(profile, history, trackingId, options = {}) {
    const expectedSets = options.expectedSets ?? 2;
    const recentSessions = sessionsForExercise(history, trackingId, options);
    return profile.type === 'variant'
        ? variantRecommendation(profile, recentSessions, expectedSets)
        : loadRecommendation(profile, recentSessions, expectedSets);
}

export function chooseAlternatingExercise(alternatives, history) {
    if (!alternatives?.length) return null;

    const lastUsed = alternatives.map((alternative, index) => {
        const latest = history
            .filter((entry) => entry.trackingId === alternative.trackingId)
            .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))[0];
        return { alternative, index, timestamp: latest ? Date.parse(latest.completedAt) : -1 };
    });

    return lastUsed.sort((a, b) => a.timestamp - b.timestamp || a.index - b.index)[0].alternative;
}

export function summarizeProgress(profile, history, trackingId, expectedSets = 2) {
    const sessions = sessionsForExercise(history, trackingId);
    const latest = sessions[0] ?? [];
    const recommendation = recommendProgression(profile, history, trackingId, { expectedSets });

    let last = 'Noch kein Eintrag';
    if (latest.length) {
        const reps = latest.map((entry) => entry.reps).join(' / ');
        const effort = latest.map((entry) => entry.rir).join(' / ');
        const setup = profile.type === 'variant'
            ? latest[0].variant || profile.initialVariant
            : formatLoad(profile, latest[0].load);
        last = `${setup} · ${reps} Wdh. · RIR ${effort}`;
    }

    const recent = sessions.slice(0, 6).map((session) => ({
        date: session[0]?.completedAt,
        reps: session.map((entry) => entry.reps),
        load: session[0]?.load ?? null,
        variant: session[0]?.variant ?? ''
    }));

    return { last, recommendation, recent };
}
