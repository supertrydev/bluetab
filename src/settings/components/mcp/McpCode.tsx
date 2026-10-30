/**
 * @module settings/components/mcp/McpCode
 *
 * Small copyable code blocks shared by the MCP settings screens.
 */

import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { t as translate } from '@/i18n';

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={
        className ??
        'absolute top-2 end-2 p-1.5 rounded-md bg-bg-1/80 hover:bg-bg-2 text-muted-foreground hover:text-foreground transition-colors'
      }
      aria-label={translate('common.copy')}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative mt-2">
      <pre dir="ltr" className="text-xs bg-bg-1 dark:bg-bg-0 border border-border rounded-lg p-3 pe-10 overflow-x-auto whitespace-pre-wrap break-all font-mono">
        {code}
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

/** A URL in a large, easy-to-copy field. */
export function UrlField({ url, label, large }: { url: string; label: string; large?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="relative">
        <code
          dir="ltr"
          className={`block bg-bg-1 dark:bg-bg-0 border border-border rounded-lg pe-12 font-mono break-all ${
            large ? 'text-sm p-3.5 text-text-strong' : 'text-xs p-2.5'
          }`}
        >
          {url}
        </code>
        <CopyButton
          text={url}
          className="absolute top-1/2 -translate-y-1/2 end-2 p-2 rounded-md bg-bg-2 hover:bg-bg-2/70 text-muted-foreground hover:text-foreground transition-colors"
        />
      </div>
    </div>
  );
}
