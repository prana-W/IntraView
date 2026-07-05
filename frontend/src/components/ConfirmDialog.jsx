import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, description, confirmText = "Delete" }) {
    if (!isOpen) return null;
    
    return (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div 
                className="bg-card border border-border shadow-2xl rounded-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                </div>
                
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                    {description}
                </p>
                
                <div className="flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose} className="hover:bg-muted">
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={() => {
                        onConfirm();
                        onClose();
                    }} className="shadow-sm">
                        {confirmText}
                    </Button>
                </div>
            </div>
        </div>
    );
}
