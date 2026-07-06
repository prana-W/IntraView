import { Github } from 'lucide-react';

const Footer = () => {
    return (
        <footer className="py-6 border-t bg-background mt-auto">
            <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground text-center md:text-left">
                    Made with <span className="text-red-500">❤️</span> by{' '}
                    <a 
                        href="https://www.linkedin.com/in/pranaw-kumar-710331215" 
                        target="_blank" 
                        rel="noreferrer"
                        className="font-medium text-foreground hover:underline"
                    >
                        Pranaw Kumar
                    </a>
                </p>
                <a
                    href="https://github.com/prana-W/intraview"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <Github className="w-4 h-4" />
                    <span>Star on GitHub</span>
                </a>
            </div>
        </footer>
    );
};

export default Footer;
