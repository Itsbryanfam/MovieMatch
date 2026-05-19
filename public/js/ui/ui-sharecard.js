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
    const W = 600, H = 720;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const COLORS = {
        bg: '#09090b',
        surface: '#18181b',
        border: 'rgba(255,255,255,0.08)',
        accent: '#818cf8',
        accentDark: '#4338ca',
        text: '#f8fafc',
        muted: '#94a3b8',
        star: '#fbbf24',
    };

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    const headerGrad = ctx.createLinearGradient(0, 0, W, 0);
    headerGrad.addColorStop(0, COLORS.accentDark);
    headerGrad.addColorStop(1, COLORS.accent);
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, W, 64);

    ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬 MovieMatch', 28, 32);

    const chainLen = state.chain.length;
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const labelY = 100;
    ctx.fillText(`CHAIN OF ${chainLen} CONNECTION${chainLen !== 1 ? 'S' : ''}`, 32, labelY);

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, labelY + 10);
    ctx.lineTo(W - 32, labelY + 10);
    ctx.stroke();

    const { entries, skipped } = selectChainEntries(state.chain);
    let y = labelY + 32;
    const lineH = 44;

    entries.forEach((item, i) => {
        const isHighlight = item._score > 0 && item._idx !== 0;
        const isFirst = item._idx === 0;
        const isLast = item._idx === state.chain.length - 1 && state.chain.length > 1;

        if (isHighlight) {
            ctx.fillStyle = 'rgba(129,140,248,0.07)';
            roundRect(ctx, 28, y - 6, W - 56, lineH - 4, 6);
            ctx.fill();
        }

        ctx.textBaseline = 'middle';
        if (isHighlight) {
            ctx.font = '13px sans-serif';
            ctx.fillText('⭐', 32, y + 10);
        }

        ctx.font = `500 13px "Plus Jakarta Sans", sans-serif`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.fillText(String(item._idx + 1).padStart(2, ' '), isHighlight ? 52 : 32, y + 10);

        ctx.fillStyle = COLORS.text;
        ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(truncate(item.playerName, 12), 72, y + 10);

        ctx.fillStyle = COLORS.text;
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        const titleX = 185;
        const titleStr = `${truncate(item.movie.title, 22)} (${item.movie.year})`;
        ctx.fillText(titleStr, titleX, y + 10);

        if (!isFirst && item.matchedActors && item.matchedActors.length > 0) {
            ctx.fillStyle = COLORS.accent;
            ctx.font = '500 12px "Plus Jakarta Sans", sans-serif';
            ctx.fillText(`↔ ${item.matchedActors[0]}`, titleX, y + 28);
        }

        if (isLast) {
            ctx.fillStyle = '#4ade80';
            ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText('✓', W - 32, y + 10);
            ctx.textAlign = 'left';
        }

        y += lineH;
    });

    if (skipped > 0) {
        ctx.font = 'italic 12px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`+ ${skipped} more connection${skipped !== 1 ? 's' : ''}`, 32, y + 10);
        y += 28;
    }

    const winnerY = Math.max(y + 20, H - 140);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, winnerY);
    ctx.lineTo(W - 32, winnerY);
    ctx.stroke();

    if (state.winner) {
        ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = 'center';
        ctx.fillText(`🏆 ${state.winner.name} wins!`, W / 2, winnerY + 36);
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`${chainLen} connections • ${state.winner.score} pts`, W / 2, winnerY + 60);
    } else if (state.gameMode === 'solo') {
        ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText(`🎬 Solo Over`, W / 2, winnerY + 36);
        ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.fillText(`Final Chain: ${chainLen} connections`, W / 2, winnerY + 60);
    } else {
        ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'center';
        ctx.fillText('🎬 Game Over!', W / 2, winnerY + 36);
    }

    // Phase 7.6 Share 2.0: additive spoiler-free emoji strip + survived
    // badge above the footer. Reuses the existing COLORS (no new colour
    // value) and the existing layout math (winnerY) — purely additive.
    // WHY these y-offsets: winnerY is always clamped to 580 (Math.max caps it
    // because 7 curated entries * 44px lineH + 132 start + 20 guard = 460 < 580).
    // Billing sub-line draws at winnerY+60 = 640. Footer band starts at H-48=672.
    // grid baseline: winnerY+70 = 650 (10px below billing, 22px above footer).
    // survived baseline: winnerY+86 = 666 (16px below grid, 6px above footer).
    // Both 650 < 672 and 666 < 672 — no overlap with footer content.
    ctx.font = '20px sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(buildEmojiGrid(state), W / 2, winnerY + 70);
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(survivedLine(state), W / 2, winnerY + 86);

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
