import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Copy, Check, Clock, AlertCircle, Trash2, Code2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { BASE } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const AI_PROMPT_TEMPLATE = (title, transcript, code) =>
`Act as an interviewer and review my approach for the problem: ${title} on LeetCode.
The below contains the entire transcript of my explanation${code ? ' and my accepted code' : ''}. Analyze every line (ignore fillers and there might be some transcription errors, but ignore those) and give me a detailed review of my approach — what was good, what could have been improved, any missed edge cases, and overall quality of my verbal explanation.

---
${transcript}${
  code
    ? `\n\n---\nMy accepted code:\n\`\`\`\n${code}\n\`\`\`\n`
    : ''
}`;

/** Convert "binary-tree-inorder-traversal" → "Binary Tree Inorder Traversal" */
function prettifySlug(slug = '') {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Unknown Problem';
}

/**
 * LeetCode prepends line numbers directly onto each line (e.g. "1class Solution {").
 * Split into { num: string, code: string } per line.
 */
function parseCodeLines(raw = '') {
    return raw.split('\n').map(line => {
        const m = line.match(/^(\d+)(.*)$/);
        if (m) return { num: m[1], code: m[2] };
        return { num: '', code: line };
    });
}

function formatDateTime(iso) {
    return new Date(iso).toLocaleString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

/** Parse raw transcript lines — each line is "[HH:MM:SS] some text" */
function parseLines(raw = '') {
    return raw
        .split('\n')
        .map(line => {
            const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s*(.+)$/);
            if (m) {
                const seconds = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
                return { timestamp: `${m[1]}:${m[2]}:${m[3]}`, seconds, text: m[4] };
            }
            if (line.trim()) return { timestamp: null, seconds: null, text: line.trim() };
            return null;
        })
        .filter(Boolean);
}

/** Given current audio time and parsed lines, return the index of the active line */
function getActiveIndex(lines, currentTime) {
    if (currentTime == null || lines.length === 0) return -1;
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].seconds == null) continue;
        if (currentTime >= lines[i].seconds) active = i;
        else break;
    }
    return active;
}

export default function TranscriptDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [transcript, setTranscript] = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState(null);
    const [copied,     setCopied]     = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [activeIdx,  setActiveIdx]  = useState(-1);
    const [codeCopied, setCodeCopied] = useState(false);
    const [showCode,   setShowCode]   = useState(false);

    const audioRef      = useRef(null);
    const lineRefs      = useRef([]);
    const userScrolling = useRef(false);
    const scrollTimer   = useRef(null);

    useEffect(() => {
        api.get(`/transcripts/${id}`)
            .then(data => setTranscript(data.transcript))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [id]);

    /* ── Audio time tracking ── */
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !transcript) return;

        const lines = parseLines(transcript.audioTranscript);

        const onTimeUpdate = () => {
            const idx = getActiveIndex(lines, audio.currentTime);
            setActiveIdx(idx);

            // Auto-scroll only if user isn't manually scrolling
            if (!userScrolling.current && idx >= 0 && lineRefs.current[idx]) {
                lineRefs.current[idx].scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                });
            }
        };

        audio.addEventListener('timeupdate', onTimeUpdate);
        return () => audio.removeEventListener('timeupdate', onTimeUpdate);
    }, [transcript]);

    /* ── Detect manual scroll to pause auto-scroll briefly ── */
    useEffect(() => {
        const onScroll = () => {
            userScrolling.current = true;
            clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
                userScrolling.current = false;
            }, 3000);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const handleCopy = useCallback(() => {
        if (!transcript) return;
        const title = prettifySlug(transcript.problemTitle);
        const full  = AI_PROMPT_TEMPLATE(title, transcript.audioTranscript || '(no transcript)', transcript.codeSnapshot || '');
        navigator.clipboard.writeText(full).then(() => {
            setCopied(true);
            toast.success('Copied with AI review prompt! 🚀');
            setTimeout(() => setCopied(false), 2500);
        }).catch(() => toast.error('Failed to copy'));
    }, [transcript]);

    const handleCodeCopy = useCallback(() => {
        if (!transcript?.codeSnapshot) return;
        navigator.clipboard.writeText(transcript.codeSnapshot).then(() => {
            setCodeCopied(true);
            toast.success('Code copied!');
            setTimeout(() => setCodeCopied(false), 2500);
        }).catch(() => toast.error('Failed to copy code'));
    }, [transcript]);

    const handleDelete = useCallback(async () => {
        if (!transcript) return;
        setIsDeleting(true);
        try {
            await api.delete(`/transcripts/${transcript._id}`);
            toast.success("Transcript deleted successfully");
            navigate('/');
        } catch (err) {
            toast.error(`Failed to delete: ${err.message}`);
            setIsDeleting(false);
        }
    }, [transcript, navigate]);

    /** Seek audio to a line's timestamp on click */
    const seekTo = useCallback((seconds) => {
        if (audioRef.current && seconds != null) {
            audioRef.current.currentTime = seconds;
            audioRef.current.play().catch(() => {});
        }
    }, []);

    /* ── Loading ── */
    if (loading) {
        return (
            <div className="w-full max-w-4xl mx-auto px-4 py-10 space-y-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-24" />
                <div className="h-8 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="space-y-3 pt-6">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex gap-3">
                            <div className="h-3.5 bg-muted rounded w-20 shrink-0" />
                            <div className={`h-3.5 bg-muted rounded ${i % 3 === 0 ? 'w-full' : i % 3 === 1 ? 'w-5/6' : 'w-4/6'}`} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /* ── Error ── */
    if (error) {
        return (
            <div className="w-full max-w-4xl mx-auto px-4 py-10">
                <div className="flex flex-col items-center gap-4 py-20 text-center">
                    <AlertCircle className="w-12 h-12 text-destructive/60" />
                    <p className="text-destructive font-medium">{error}</p>
                    <Button variant="outline" onClick={() => navigate('/')}>← Back to Dashboard</Button>
                </div>
            </div>
        );
    }

    if (!transcript) return null;

    const title = prettifySlug(transcript.problemTitle);
    const lines = parseLines(transcript.audioTranscript);

    return (
        <div className="w-full max-w-4xl mx-auto px-4 py-10">
            {/* Back button */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-2"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Button>

            {/* Header */}
            <div className="mb-8">
                <div className="flex items-start justify-between gap-4">
                    <h1 className="text-3xl font-bold tracking-tight leading-tight">{title}</h1>
                    <div className="flex gap-2">
                        <Button
                            variant="destructive"
                            onClick={() => setShowDeleteDialog(true)}
                            disabled={isDeleting}
                            className="shrink-0 gap-2 shadow-sm"
                        >
                            <Trash2 className="w-4 h-4" /> Delete
                        </Button>
                        <Button
                            onClick={handleCopy}
                            className="shrink-0 gap-2 shadow-lg shadow-primary/25"
                            disabled={copied}
                        >
                            {copied
                                ? <><Check className="w-4 h-4" /> Copied!</>
                                : <><Copy className="w-4 h-4" /> Copy with AI Prompt</>
                            }
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDateTime(transcript.createdAt)}
                    </span>
                    {transcript.problemLink && (
                        <Link
                            to={transcript.problemLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:text-primary transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View on LeetCode
                        </Link>
                    )}
                    <span className="ml-auto text-xs">
                        {lines.length} chunk{lines.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>


            {/* Divider */}
            <div className="border-t border-border mb-8" />

            {/* Audio Player */}
            {transcript.sessionId && (
                <div className="mb-8 p-4 rounded-xl border border-border bg-card shadow-sm">
                    <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                        Listen to Recording
                    </h3>
                    <audio ref={audioRef} controls className="w-full outline-none">
                        <source src={`${BASE}/audio/${transcript.sessionId}.wav`} type="audio/wav" />
                        <source src={`${BASE}/audio/${transcript.sessionId}.webm`} type="audio/webm" />
                    </audio>
                </div>
            )}

            {/* Code Snapshot — only shown when user had an accepted submission */}
            {transcript.codeSnapshot && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Code2 className="w-4 h-4 text-green-500" />
                            Accepted Code
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowCode(v => !v)}
                                className="gap-1.5 h-7 text-xs text-muted-foreground"
                            >
                                {showCode ? 'Hide code' : 'Show code'}
                            </Button>
                            {showCode && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCodeCopy}
                                    className="gap-1.5 h-7 text-xs text-muted-foreground"
                                >
                                    {codeCopied
                                        ? <><Check className="w-3 h-3" /> Copied!</>
                                        : <><Copy className="w-3 h-3" /> Copy</>
                                    }
                                </Button>
                            )}
                        </div>
                    </div>
                    {showCode && (
                        <div className="relative rounded-xl border border-green-500/20 bg-[#0d1117] overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-green-500/10 bg-green-500/5">
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                <span className="text-xs text-green-500/80 font-medium">Accepted submission</span>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-96">
                                <table className="w-full border-collapse">
                                    <tbody>
                                        {parseCodeLines(transcript.codeSnapshot).map((line, i) => (
                                            <tr key={i} className="group hover:bg-white/[0.03] transition-colors">
                                                {/* Line number gutter */}
                                                <td className="select-none text-right pr-4 pl-4 py-0.5 border-r border-white/[0.06] w-12 shrink-0"
                                                    style={{ color: `hsl(${200 + (i * 7) % 60}, 60%, 55%)`, opacity: 0.6 }}>
                                                    <span className="font-mono text-[11px]">{line.num || i + 1}</span>
                                                </td>
                                                {/* Code */}
                                                <td className="pl-5 pr-4 py-0.5">
                                                    <span className="font-mono text-[12px] text-[#e6edf3] whitespace-pre">{line.code}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Transcript */}
            {lines.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                    <p>No transcript was recorded for this session.</p>
                </div>
            ) : (
                <div className="space-y-1">
                    {lines.map((line, idx) => {
                        const isActive = idx === activeIdx;
                        return (
                            <div
                                key={idx}
                                ref={el => lineRefs.current[idx] = el}
                                onClick={() => seekTo(line.seconds)}
                                className={`group flex gap-4 items-baseline py-2.5 px-3 rounded-lg transition-all duration-300 ${
                                    line.seconds != null ? 'cursor-pointer' : ''
                                } ${
                                    isActive
                                        ? 'bg-primary/10 border border-primary/20 shadow-sm'
                                        : 'hover:bg-muted/50 border border-transparent'
                                }`}
                                title={line.seconds != null ? `Seek to ${line.timestamp}` : undefined}
                            >
                                {/* Timestamp */}
                                <span
                                    className={`shrink-0 font-mono text-xs w-16 text-right transition-colors select-none ${
                                        isActive
                                            ? 'text-primary font-semibold'
                                            : 'text-muted-foreground/60 group-hover:text-primary/70'
                                    }`}
                                >
                                    {line.timestamp || '—'}
                                </span>

                                {/* Divider */}
                                <span className={`shrink-0 w-px h-4 self-center transition-colors ${isActive ? 'bg-primary/40' : 'bg-border'}`} />

                                {/* Text */}
                                <p className={`text-sm leading-relaxed transition-colors ${isActive ? 'text-foreground font-medium' : 'text-foreground/90'}`}>
                                    {line.text}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
            
            <ConfirmDialog 
                isOpen={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={handleDelete}
                title="Delete Transcript"
                description="Are you sure you want to permanently delete this transcript and its associated audio file? This action cannot be undone."
            />
        </div>
    );
}
