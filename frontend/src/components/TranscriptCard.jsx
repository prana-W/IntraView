import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, ExternalLink, ChevronRight } from 'lucide-react';

/** Convert a slug like "binary-tree-inorder-traversal" to "Binary Tree Inorder Traversal" */
function prettifySlug(slug = '') {
    return slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ') || 'Unknown Problem';
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

/** Extract a 120-char preview from the raw transcript text */
function getPreview(text = '') {
    // Strip timestamps like "[14:22:05] " from preview
    const clean = text.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/g, '');
    return clean.length > 130 ? clean.slice(0, 130) + '…' : clean;
}

export default function TranscriptCard({ transcript }) {
    const navigate = useNavigate();
    const title = prettifySlug(transcript.problemTitle);
    const preview = getPreview(transcript.audioTranscript);
    const lineCount = transcript.audioTranscript?.split('\n').filter(Boolean).length || 0;

    return (
        <Card
            onClick={() => navigate(`/transcript/${transcript._id}`)}
            className="group cursor-pointer border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 hover:-translate-y-0.5"
        >
            <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-base leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {title}
                    </h3>
                    <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                </div>

                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(transcript.createdAt)}
                    </span>
                    <span>{formatTime(transcript.createdAt)}</span>
                    {transcript.problemLink && (
                        <a
                            href={transcript.problemLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 hover:text-primary transition-colors ml-auto"
                        >
                            LeetCode <ExternalLink className="w-3 h-3" />
                        </a>
                    )}
                </div>
            </CardHeader>

            <CardContent className="pt-0">
                {preview ? (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">{preview}</p>
                ) : (
                    <p className="text-sm text-muted-foreground italic">No transcript recorded.</p>
                )}
                {lineCount > 0 && (
                    <div className="mt-3">
                        <Badge variant="secondary" className="text-xs">
                            {lineCount} chunk{lineCount !== 1 ? 's' : ''}
                        </Badge>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
