// ui/ui-sharecard.js — canvas share-card generation, text recap, and modal open.
// WHY: the canvas-drawing and text-export logic is large and self-contained;
// separating it means render.js and panels.js stay focused on live-DOM work
// while sharecard.js owns all "export this result as an image/text" paths.

// Import DOM refs — shareCanvas and shareModal are live bindings from ui-dom.js.
import { shareCanvas, shareModal } from './ui-dom.js';
// Phase 7.6: selectChainEntries/scoreChainEntry RELOCATED to the pure
// zero-import chain-recap.js (its new home — keeps that engine pure & DRY).
// Imported back for generateShareCard's internal use AND re-exported under
// the SAME names so this module's public surface is byte-stable for every
// existing importer (spec §3.2 / §5 ratchet).
import { selectChainEntries, scoreChainEntry } from './chain-recap.js';
export { selectChainEntries, scoreChainEntry };

export function generateShareCard(state) {
    // Phase 7.6.3 — share card redesigned to the Theater Lobby / Chain
    // Premiere Recap aesthetic (user feedback: the old card's wordmark
    // wasn't the site's two-tone logo, the type was cramped, and a short
    // chain left a big dead void with the winner jammed to the bottom).
    // STILL 600x720 (sharecard.test.js pins it) and EVERY pure export
    // (selectChainEntries/scoreChainEntry/truncate/roundRect/buildEmojiGrid/
    // survivedLine/buildTextRecap/openShareModal) is byte-identical — only
    // generateShareCard's own drawing changed.
    const W = 600, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Palette = the SITE tokens (01-base.css) — NOT new colours. `muted`
    // is now #a8b2c4 (the real --text-muted used across the app + the
    // recap), removing the prior off-token near-duplicate #94a3b8. The
    // verbatim accent rgba(129,140,248,…) literals are the SAME ones the
    // lobby `.theater .screen` / recap rules already use (CSS/canvas have
    // no var()-with-opacity; the brand-rgba literal is the established
    // pattern, not a new colour).
    const COLORS = {
        bg: '#09090b',          // --bg-base
        surface: '#18181b',     // --bg-elevated
        border: 'rgba(255,255,255,0.08)', // --border-subtle
        accent: '#818cf8',      // --accent-primary
        accentDark: '#4338ca',
        text: '#f8fafc',        // --text-main
        muted: '#a8b2c4',       // --text-muted (site/recap token)
        star: '#fbbf24',        // --accent-warm-ish (⭐ highlight)
        good: '#4ade80',        // existing ✓ colour (unchanged)
    };
    // jsdom-safe text width (the test canvas shim returns a stub ctx;
    // measureText is shimmed but guard anyway). Real browsers get true
    // metrics so the two-tone wordmark / centred labels are pixel-centred.
    const tw = (s) => { try { return ctx.measureText(s).width || 0; } catch { return 0; } };

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // --- Header: a cinema screen, mirroring the lobby `.theater .screen`
    // (vertical #1a1b22→#0f1015 + a bottom accent hairline) instead of the
    // old flat purple bar, so the two-tone wordmark reads on dark like the
    // real site header. createLinearGradient is in the shim;
    // createRadialGradient is NOT — deliberately avoided so the test stays
    // green WITHOUT touching client-tests/setup.js again.
    const HEADER_H = 92;
    const hg = ctx.createLinearGradient(0, 0, 0, HEADER_H);
    hg.addColorStop(0, '#1a1b22');
    hg.addColorStop(1, '#0f1015');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.strokeStyle = 'rgba(129,140,248,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEADER_H);
    ctx.lineTo(W, HEADER_H);
    ctx.stroke();

    // Two-tone wordmark = the site `.logo` exactly: "Movie" in --text-main
    // + "Match" in --accent-primary, weight 800, NO 🎬 (the real
    // `<div class="logo">Movie<span>Match</span></div>` has none). Centred
    // for the poster format.
    ctx.font = '800 30px "Plus Jakarta Sans", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const wMovie = tw('Movie');
    const markX = (W - (wMovie + tw('Match'))) / 2;
    const markY = HEADER_H / 2;
    ctx.fillStyle = COLORS.text;
    ctx.fillText('Movie', markX, markY);
    ctx.fillStyle = COLORS.accent;
    ctx.fillText('Match', markX + wMovie, markY);

    const chainLen = state.chain.length;

    // --- Chain eyebrow: accent, uppercase, centred — the same micro-label
    // treatment as the lobby/recap `.screen-eyebrow`/`.recap-screen-eyebrow`.
    ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.accent;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    const eyebrowY = 128;
    ctx.fillText(`CHAIN OF ${chainLen} CONNECTION${chainLen !== 1 ? 'S' : ''}`, W / 2, eyebrowY);

    const chainDivY = eyebrowY + 18;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, chainDivY);
    ctx.lineTo(W - 40, chainDivY);
    ctx.stroke();

    // --- Billing block is anchored near the bottom (a deliberate film
    // "billing" convention — looks intentional, not jammed). The CHAIN
    // block is then VERTICALLY CENTRED in the band between the chain
    // divider and the billing divider, so a short chain no longer leaves a
    // huge dead void (the reported problem) and a full 7-row chain still
    // fits. Anchors derived bottom-up so the footer/grid/billing never
    // overlap regardless of chain length.
    const BILLING_DIV_Y = 524;          // winner-marquee divider
    const lineH = 46;                   // roomier rows (was 44) — less cramped
    const { entries, skipped } = selectChainEntries(state.chain);
    const skipH = skipped > 0 ? 28 : 0;
    const contentH = entries.length * lineH + skipH;
    const bandTop = chainDivY + 22;
    const bandBottom = BILLING_DIV_Y - 16;
    const usable = bandBottom - bandTop;
    let y = bandTop + Math.max(0, (usable - contentH) / 2); // centre when it fits

    entries.forEach((item) => {
        const isHighlight = item._score > 0 && item._idx !== 0;
        const isFirst = item._idx === 0;
        const isLast = item._idx === state.chain.length - 1 && state.chain.length > 1;
        const rowMid = y + lineH / 2;

        if (isHighlight) {
            // subtle accent wash — verbatim brand rgba, as before
            ctx.fillStyle = 'rgba(129,140,248,0.07)';
            roundRect(ctx, 32, y + 2, W - 64, lineH - 6, 8);
            ctx.fill();
        }

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const numX = isHighlight ? 56 : 40;
        if (isHighlight) {
            ctx.font = '14px sans-serif';
            ctx.fillText('⭐', 36, rowMid);
        }
        ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.accent;
        ctx.fillText(String(item._idx + 1).padStart(2, ' '), numX, rowMid);

        ctx.fillStyle = COLORS.text;
        ctx.font = '600 15px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(truncate(item.playerName, 12), numX + 34, rowMid);

        const titleX = 210;
        ctx.fillStyle = COLORS.text;
        ctx.font = '500 15px "Plus Jakarta Sans", sans-serif';
        const hasBridge = !isFirst && item.matchedActors && item.matchedActors.length > 0;
        const titleStr = `${truncate(item.movie.title, 22)} (${item.movie.year})`;
        // nudge the title up a touch when a bridge sub-line follows so the
        // pair sits balanced in the taller row
        ctx.fillText(titleStr, titleX, hasBridge ? rowMid - 8 : rowMid);
        if (hasBridge) {
            ctx.fillStyle = COLORS.accent;
            ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
            ctx.fillText(`↔ ${item.matchedActors[0]}`, titleX, rowMid + 10);
        }

        if (isLast) {
            ctx.fillStyle = COLORS.good;
            ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('✓', W - 40, rowMid);
            ctx.textAlign = 'left';
        }

        y += lineH;
    });

    if (skipped > 0) {
        ctx.font = 'italic 13px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+ ${skipped} more connection${skipped !== 1 ? 's' : ''}`, W / 2, y + 14);
    }

    // --- Billing marquee divider + the winner block, mirroring the recap
    // finale (accent eyebrow → big title with a soft accent glow → muted
    // sub). Anchors fixed bottom-up; no clamp-to-bottom void any more.
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, BILLING_DIV_Y);
    ctx.lineTo(W - 40, BILLING_DIV_Y);
    ctx.stroke();

    let eyebrow, bigLine, subLine;
    if (state.winner) {
        eyebrow = 'CHAMPION';
        bigLine = `🏆 ${state.winner.name} wins!`;
        subLine = `${chainLen} connection${chainLen !== 1 ? 's' : ''} • ${state.winner.score} pts`;
    } else if (state.gameMode === 'solo') {
        eyebrow = 'FINAL CUT';
        bigLine = '🎬 Solo Over';
        subLine = `Final chain: ${chainLen} connection${chainLen !== 1 ? 's' : ''}`;
    } else {
        eyebrow = "THAT'S A WRAP";
        bigLine = '🎬 Game Over!';
        subLine = `${chainLen} connection${chainLen !== 1 ? 's' : ''} total`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(eyebrow, W / 2, BILLING_DIV_Y + 30);

    // soft accent glow on the headline = the recap/lobby text-shadow
    // (rgba(129,140,248,…), verbatim brand). Set then EXPLICITLY reset
    // (NOT ctx.save/restore — those are deliberately absent from the
    // jsdom canvas shim in client-tests/setup.js; plain property writes
    // keep the test green WITHOUT re-touching that shared shim, and an
    // explicit reset is correct on a real canvas too since no other
    // state was saved).
    ctx.shadowColor = 'rgba(129,140,248,0.45)';
    ctx.shadowBlur = 18;
    ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(bigLine, W / 2, BILLING_DIV_Y + 64);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(subLine, W / 2, BILLING_DIV_Y + 90);

    // Phase 7.6 Share 2.0 (preserved): spoiler-free emoji strip + survived
    // line. buildEmojiGrid/survivedLine are UNCHANGED pure exports; only
    // their baselines move into the new bottom-up rhythm.
    ctx.font = '22px sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(buildEmojiGrid(state), W / 2, BILLING_DIV_Y + 124);
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(survivedLine(state), W / 2, BILLING_DIV_Y + 150);

    // --- Footer (unchanged behaviour): site URL on a fade.
    const footerGrad = ctx.createLinearGradient(0, H - 48, 0, H);
    footerGrad.addColorStop(0, 'transparent');
    footerGrad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = footerGrad;
    ctx.fillRect(0, H - 48, W, 48);

    const siteUrl = window.location.hostname !== 'localhost'
        ? window.location.hostname
        : 'moviematch.it.com';
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.fillText(siteUrl, W / 2, H - 16);

    return canvas;
}

export function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

export function openShareModal(gameState) {
  document.fonts.ready.then(() => {
    const generated = generateShareCard(gameState);
    shareCanvas.width = generated.width;
    shareCanvas.height = generated.height;
    shareCanvas.getContext('2d').drawImage(generated, 0, 0);
    shareModal.classList.remove('hidden');
  });
}

// Phase 7.6 Share 2.0: spoiler-free result strip — one emoji per CURATED
// chain entry, encoding the same signal scoreChainEntry already computes.
// WHY: shareable like a Framed/Wordle grid WITHOUT leaking titles or any
// identifier (zero-identity — the Phase-1 daily-leaderboard security
// invariant). Reuses the relocated selectChainEntries/scoreChainEntry.
export function buildEmojiGrid(state) {
  const chain = Array.isArray(state && state.chain) ? state.chain : [];
  const { entries, skipped } = selectChainEntries(chain);
  const lastIdx = chain.length - 1;
  const glyphs = entries.map((e) => {
    if (e._idx === 0) return '🎬';
    if (e._idx === lastIdx && chain.length > 1) return '🏁';
    // "spicy" link: a high cross-media / deep-cast / era-jump score.
    return scoreChainEntry(e, e._idx, chain) >= 5 ? '🔥' : '🟦';
  }).join('');
  return skipped > 0 ? `${glyphs} +${skipped}` : glyphs;
}

// Phase 7.6 Share 2.0: first-person, integer-only "survived" line. WHY:
// no name/identifier (zero-identity); a personal, shareable badge of the
// chain length the player reached.
export function survivedLine(state) {
  const n = Array.isArray(state && state.chain) ? state.chain.length : 0;
  return `🔗 I survived ${n} links`;
}

export function buildTextRecap(state) {
    const lines = ['🎬 MovieMatch\n'];
    lines.push(`Chain of ${state.chain.length} connections:\n`);
    state.chain.forEach((item, i) => {
        const actor = (item.matchedActors || [])[0];
        lines.push(`${i + 1}. ${item.playerName} → ${item.movie.title} (${item.movie.year})${actor ? ` ↔ ${actor}` : ''}`);
    });
    if (state.winner) lines.push(`\n🏆 ${state.winner.name} wins with ${state.winner.score} pts!`);
    // Phase 7.6 Share 2.0: additive spoiler-free grid + survived badge.
    // WHY before siteUrl: the emoji strip reads like a Wordle/Framed share
    // block, sitting between the winner line and the "Play at" call-to-action.
    lines.push(`\n${buildEmojiGrid(state)}`);
    lines.push(survivedLine(state));
    const siteUrl = window.location.hostname !== 'localhost' ? window.location.hostname : 'moviematch.it.com';
    lines.push(`\nPlay at ${siteUrl}`);
    return lines.join('\n');
}
