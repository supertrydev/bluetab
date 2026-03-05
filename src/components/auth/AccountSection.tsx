/**
 * @module components/auth/AccountSection
 *
 * WHY: Display account status in settings page.
 *
 * WHAT: Shows OSS Core status and upcoming cloud features.
 *
 * HOW: A static display for the Open Source Edition.
 */

import { Button } from '../ui/button'
import {
    User,
    Crown,
    RefreshCw,
    ExternalLink,
    Cloud,
    Users,
    Github
} from 'lucide-react'

export function AccountSection() {
    const handleUpgrade = () => {
        chrome.tabs.create({ url: `https://github.com/supertrydev/bluetab` })
    }

    return (
        <div className="space-y-6">
            {/* Section Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <User className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-medium text-text-strong">Account & Sync</h3>
            </div>

            {/* Main Account Card - Open Source Edition */}
            <div className="rounded-xl bg-bg-1 border border-border shadow-sm overflow-hidden">
                <div className="p-8 text-center flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center mb-4 shadow-md text-white">
                        <Github className="h-8 w-8" />
                    </div>
                    <h4 className="text-text-strong font-semibold text-xl mb-1">BlueTab Open Source Core</h4>
                    <span className="bg-primary/15 text-primary tracking-wide uppercase text-xs font-bold px-3 py-1 rounded-full mb-6">
                        Local First
                    </span>
                    <p className="text-sm text-text-muted mb-6 max-w-sm mx-auto leading-relaxed">
                        You are running the free, open-source version of BlueTab. Your data is encrypted and stored locally on this device completely offline.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center w-full max-w-xs">
                        <Button
                            onClick={handleUpgrade}
                            variant="outline"
                            className="bg-bg-1 hover:bg-bg-2 border-border shadow-sm w-full"
                        >
                            <Github className="h-4 w-4 mr-2" />
                            Star on GitHub
                        </Button>
                    </div>
                </div>
            </div>

            {/* Premium Features Card - Coming Soon */}
            <div className="rounded-xl overflow-hidden border border-border bg-bg-1 shadow-sm">
                {/* Header */}
                <div className="px-5 py-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-purple-500/15">
                            <Cloud className="h-5 w-5 text-purple-500" />
                        </div>
                        <span className="font-semibold text-text-strong">BlueTab Cloud (Coming Soon)</span>
                    </div>
                </div>

                {/* Features Grid */}
                <div className="p-5">
                    <p className="text-sm text-text-muted mb-4">
                        We are working hard on bringing end-to-end encrypted cloud sync and automation to BlueTab.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FeatureItem icon={Cloud} text="Cross-device Sync" color="text-purple-500" bg="bg-purple-500/10" />
                        <FeatureItem icon={RefreshCw} text="Automated Backups" color="text-purple-500" bg="bg-purple-500/10" />
                        <FeatureItem icon={Users} text="Team & Workspace Sharing" color="text-purple-500" bg="bg-purple-500/10" />
                        <FeatureItem icon={Crown} text="Flow Automation Engine" color="text-purple-500" bg="bg-purple-500/10" />
                    </div>

                    <Button
                        onClick={handleUpgrade}
                        variant="secondary"
                        className="w-full mt-6 bg-purple-500/10 text-purple-600 hover:bg-purple-500/20 shadow-none dark:text-purple-400"
                    >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Follow Updates on GitHub
                    </Button>
                </div>
            </div>
        </div>
    )
}

function FeatureItem({ icon: Icon, text, color, bg }: { icon: React.ElementType; text: string; color: string; bg: string }) {
    return (
        <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-bg-2/50 border border-border-subtle hover:bg-bg-2 transition-colors">
            <div className={`p-1 rounded ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
            </div>
            <span className="text-sm text-text flex-1">{text}</span>
            <span className="text-[10px] uppercase font-bold text-text-muted/60 bg-text-muted/10 px-1.5 py-0.5 rounded">Soon</span>
        </div>
    )
}
