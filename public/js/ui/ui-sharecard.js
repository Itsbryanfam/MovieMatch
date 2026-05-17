// ui/ui-sharecard.js — canvas share-card generation, text recap, and modal open.
// WHY: the canvas-drawing and text-export logic is large and self-contained;
// separating it means render.js and panels.js stay focused on live-DOM work
// while sharecard.js owns all "export this result as an image/text" paths.

// Import DOM refs — shareCanvas and shareModal are live bindings from ui-dom.js.
import { shareCanvas, shareModal } from './ui-dom.js';

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

export function scoreChainEntry(item, index, chain) {
    if (index === 0) return -1;
    let score = 0;
    const prev = chain[index - 1];

    if (prev.movie.mediaType && item.movie.mediaType &&
        prev.movie.mediaType !== item.movie.mediaType) {
        score += 3;
    }

    const actor = (item.matchedActors || [])[0];
    if (actor) {
        // H4: cast entries are now {id, name} objects (with legacy bare-string
        // entries possible during the transition). Compare on the name field;
        // matchedActors stays as bare strings for client-display compatibility.
        const pos = (item.movie.cast || []).findIndex(c => {
            const cName = typeof c === 'string' ? c : (c && c.name) || '';
            return cName.toLowerCase() === actor.toLowerCase();
        });
        if (pos > 4) score += 2;
    }

    const prevYear = parseInt(prev.movie.year);
    const currYear = parseInt(item.movie.year);
    if (!isNaN(prevYear) && !isNaN(currYear)) {
        score += Math.floor(Math.abs(currYear - prevYear) / 10);
    }

    return score;
}

export function selectChainEntries(chain) {
    const MAX = 7;
    if (chain.length <= MAX) return { entries: chain.map((c, i) => ({ ...c, _idx: i })), skipped: 0 };

    const scored = chain.map((item, i) => ({ ...item, _idx: i, _score: scoreChainEntry(item, i, chain) }));

    const first = scored[0];
    const last = scored[scored.length - 1];

    const middle = scored.slice(1, -1)
        .sort((a, b) => b._score - a._score)
        .slice(0, 5)
        .sort((a, b) => a._idx - b._idx);

    const entries = [first, ...middle, last];
    const skipped = chain.length - entries.length;
    return { entries, skipped };
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

export function buildTextRecap(state) {
    const lines = ['🎬 MovieMatch\n'];
    lines.push(`Chain of ${state.chain.length} connections:\n`);
    state.chain.forEach((item, i) => {
        const actor = (item.matchedActors || [])[0];
        lines.push(`${i + 1}. ${item.playerName} → ${item.movie.title} (${item.movie.year})${actor ? ` ↔ ${actor}` : ''}`);
    });
    if (state.winner) lines.push(`\n🏆 ${state.winner.name} wins with ${state.winner.score} pts!`);
    const siteUrl = window.location.hostname !== 'localhost' ? window.location.hostname : 'moviematch.it.com';
    lines.push(`\nPlay at ${siteUrl}`);
    return lines.join('\n');
}
