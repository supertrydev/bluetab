import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

interface CopyLinkButtonProps {
  onCopy: () => void;
}

/** Copy action of a saved tab row; shows on hover of the enclosing `group/tab`. */
export function CopyLinkButton({ onCopy }: CopyLinkButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const label = copied ? t('sidepanel.tabItem.copied') : t('sidepanel.tabItem.copyLink');
  return (
    <Button
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      }}
      size="sm"
      variant="ghost"
      className={`h-7 w-7 shrink-0 p-0 transition-all duration-200 ${copied ? 'text-success scale-110' : 'text-text-muted hover:text-text-strong [@media(hover:hover)]:opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100'}`}
      title={label}
      aria-label={label}
    >
      {copied
        ? <Check className="w-3.5 h-3.5 transition-transform duration-200" />
        : <Copy className="w-3.5 h-3.5 transition-transform duration-200" />
      }
    </Button>
  );
}
