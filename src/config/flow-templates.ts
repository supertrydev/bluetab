/**
 * Flow Templates
 *
 * Pre-built automation rules for popular social media platforms.
 * Users can import these templates to quickly set up Flow rules.
 */

import type { FlowTemplate } from '../types/flow';

export const FLOW_TEMPLATES: FlowTemplate[] = [
    {
        id: 'youtube',
        name: 'YouTube',
        description: 'Videos, shorts, channels, and playlists',
        platform: 'youtube',
        icon: 'Youtube',
        color: '#FF0000',
        rules: [
            {
                name: 'YouTube Videos',
                description: 'Auto-group YouTube videos',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'yt-domain', type: 'domain_contains', value: 'youtube.com' },
                    { id: 'yt-watch', type: 'path_contains', value: '/watch' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'YouTube Videos',
                    groupColor: '#FF0000'
                }
            },
            {
                name: 'YouTube Shorts',
                description: 'Auto-group YouTube Shorts',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'yts-domain', type: 'domain_contains', value: 'youtube.com' },
                    { id: 'yts-shorts', type: 'path_contains', value: '/shorts' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'YouTube Shorts',
                    groupColor: '#FF0000'
                }
            },
            {
                name: 'YouTube Channels',
                description: 'Auto-group YouTube channels',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'ytc-domain', type: 'domain_contains', value: 'youtube.com' },
                    { id: 'ytc-channel', type: 'path_contains', value: '/@' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'YouTube Channels',
                    groupColor: '#FF0000'
                }
            },
            {
                name: 'YouTube Playlists',
                description: 'Auto-group YouTube playlists',
                enabled: true,
                priority: 3,
                conditions: [
                    { id: 'ytp-domain', type: 'domain_contains', value: 'youtube.com' },
                    { id: 'ytp-playlist', type: 'path_contains', value: '/playlist' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'YouTube Playlists',
                    groupColor: '#FF0000'
                }
            }
        ]
    },
    {
        id: 'x',
        name: 'X',
        description: 'Posts and profiles',
        platform: 'x',
        icon: 'X',
        color: '#000000',
        rules: [
            {
                name: 'X Posts',
                description: 'Auto-group X posts',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'x-posts-domain', type: 'domain_contains', value: 'x.com' },
                    { id: 'x-posts-path', type: 'path_contains', value: '/status/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'X Posts',
                    groupColor: '#000000'
                }
            },
            {
                name: 'X Profiles',
                description: 'Auto-group X profiles',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'x-profiles-domain', type: 'domain_contains', value: 'x.com' },
                    { id: 'x-profiles-regex', type: 'url_matches_regex', value: 'x\\.com/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'X Profiles',
                    groupColor: '#000000'
                }
            }
        ]
    },
    {
        id: 'instagram',
        name: 'Instagram',
        description: 'Posts, reels, stories, and profiles',
        platform: 'instagram',
        icon: 'Instagram',
        color: '#E4405F',
        rules: [
            {
                name: 'Instagram Reels',
                description: 'Auto-group Instagram reels',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'ig-reels-domain', type: 'domain_contains', value: 'instagram.com' },
                    { id: 'ig-reels-path', type: 'path_contains', value: '/reels/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Instagram Reels',
                    groupColor: '#E4405F'
                }
            },
            {
                name: 'Instagram Stories',
                description: 'Auto-group Instagram stories',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'ig-stories-domain', type: 'domain_contains', value: 'instagram.com' },
                    { id: 'ig-stories-path', type: 'path_contains', value: '/stories/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Instagram Stories',
                    groupColor: '#E4405F'
                }
            },
            {
                name: 'Instagram Posts',
                description: 'Auto-group Instagram posts',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'ig-posts-domain', type: 'domain_contains', value: 'instagram.com' },
                    { id: 'ig-posts-path', type: 'path_contains', value: '/p/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Instagram Posts',
                    groupColor: '#E4405F'
                }
            },
            {
                name: 'Instagram Profiles',
                description: 'Auto-group Instagram profiles',
                enabled: true,
                priority: 3,
                conditions: [
                    { id: 'ig-profiles-domain', type: 'domain_contains', value: 'instagram.com' },
                    { id: 'ig-profiles-regex', type: 'url_matches_regex', value: 'instagram\\.com/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Instagram Profiles',
                    groupColor: '#E4405F'
                }
            }
        ]
    },
    {
        id: 'facebook',
        name: 'Facebook',
        description: 'Posts, profiles, and reels',
        platform: 'facebook',
        icon: 'Facebook',
        color: '#1877F2',
        rules: [
            {
                name: 'Facebook Reels',
                description: 'Auto-group Facebook reels',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'fb-reels-domain', type: 'domain_contains', value: 'facebook.com' },
                    { id: 'fb-reels-path', type: 'path_contains', value: '/reel/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Facebook Reels',
                    groupColor: '#1877F2'
                }
            },
            {
                name: 'Facebook Posts',
                description: 'Auto-group Facebook posts',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'fb-posts-domain', type: 'domain_contains', value: 'facebook.com' },
                    { id: 'fb-posts-regex', type: 'url_matches_regex', value: 'facebook\\.com.*/posts/|facebook\\.com/permalink\\.php' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Facebook Posts',
                    groupColor: '#1877F2'
                }
            },
            {
                name: 'Facebook Profiles',
                description: 'Auto-group Facebook profiles',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'fb-profiles-domain', type: 'domain_contains', value: 'facebook.com' },
                    { id: 'fb-profiles-path', type: 'path_contains', value: '/profile.php' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Facebook Profiles',
                    groupColor: '#1877F2'
                }
            },
            {
                name: 'Facebook Pages',
                description: 'Auto-group Facebook pages',
                enabled: true,
                priority: 3,
                conditions: [
                    { id: 'fb-pages-domain', type: 'domain_contains', value: 'facebook.com' },
                    { id: 'fb-pages-regex', type: 'url_matches_regex', value: 'facebook\\.com/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Facebook Profiles',
                    groupColor: '#1877F2'
                }
            }
        ]
    },
    {
        id: 'linkedin',
        name: 'LinkedIn',
        description: 'Jobs, profiles, companies, products, and posts',
        platform: 'linkedin',
        icon: 'Linkedin',
        color: '#0A66C2',
        rules: [
            {
                name: 'LinkedIn Jobs',
                description: 'Auto-group LinkedIn job listings',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'li-jobs-domain', type: 'domain_contains', value: 'linkedin.com' },
                    { id: 'li-jobs-path', type: 'path_contains', value: '/jobs/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'LinkedIn Jobs',
                    groupColor: '#0A66C2'
                }
            },
            {
                name: 'LinkedIn Profiles',
                description: 'Auto-group LinkedIn profiles',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'li-profiles-domain', type: 'domain_contains', value: 'linkedin.com' },
                    { id: 'li-profiles-path', type: 'path_contains', value: '/in/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'LinkedIn Profiles',
                    groupColor: '#0A66C2'
                }
            },
            {
                name: 'LinkedIn Companies',
                description: 'Auto-group LinkedIn company pages',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'li-company-domain', type: 'domain_contains', value: 'linkedin.com' },
                    { id: 'li-company-path', type: 'path_contains', value: '/company/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'LinkedIn Companies',
                    groupColor: '#0A66C2'
                }
            },
            {
                name: 'LinkedIn Products',
                description: 'Auto-group LinkedIn product pages',
                enabled: true,
                priority: 3,
                conditions: [
                    { id: 'li-products-domain', type: 'domain_contains', value: 'linkedin.com' },
                    { id: 'li-products-path', type: 'path_contains', value: '/products/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'LinkedIn Products',
                    groupColor: '#0A66C2'
                }
            },
            {
                name: 'LinkedIn Posts',
                description: 'Auto-group LinkedIn posts',
                enabled: true,
                priority: 4,
                conditions: [
                    { id: 'li-posts-domain', type: 'domain_contains', value: 'linkedin.com' },
                    { id: 'li-posts-path', type: 'path_contains', value: '/posts/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'LinkedIn Posts',
                    groupColor: '#0A66C2'
                }
            }
        ]
    },
    {
        id: 'reddit',
        name: 'Reddit',
        description: 'Posts and subreddits',
        platform: 'reddit',
        icon: 'Reddit',
        color: '#FF4500',
        rules: [
            {
                name: 'Reddit Posts',
                description: 'Auto-group Reddit posts',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'rd-posts-domain', type: 'domain_contains', value: 'reddit.com' },
                    { id: 'rd-posts-path', type: 'path_contains', value: '/comments/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Reddit Posts',
                    groupColor: '#FF4500'
                }
            },
            {
                name: 'Reddit Subreddits',
                description: 'Auto-group Reddit subreddits',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'rd-subs-domain', type: 'domain_contains', value: 'reddit.com' },
                    { id: 'rd-subs-regex', type: 'url_matches_regex', value: 'reddit\\.com/r/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Reddit Subreddits',
                    groupColor: '#FF4500'
                }
            }
        ]
    },
    {
        id: 'tiktok',
        name: 'TikTok',
        description: 'Videos and profiles',
        platform: 'tiktok',
        icon: 'Tiktok',
        color: '#000000',
        rules: [
            {
                name: 'TikTok Videos',
                description: 'Auto-group TikTok videos',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'tt-videos-domain', type: 'domain_contains', value: 'tiktok.com' },
                    { id: 'tt-videos-path', type: 'path_contains', value: '/video/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'TikTok Videos',
                    groupColor: '#FE2C55'
                }
            },
            {
                name: 'TikTok Profiles',
                description: 'Auto-group TikTok profiles',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'tt-profiles-domain', type: 'domain_contains', value: 'tiktok.com' },
                    { id: 'tt-profiles-regex', type: 'url_matches_regex', value: 'tiktok\\.com/@[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'TikTok Profiles',
                    groupColor: '#FE2C55'
                }
            }
        ]
    },
    {
        id: 'github',
        name: 'GitHub',
        description: 'Repos, issues, and PRs',
        platform: 'github',
        icon: 'Github',
        color: '#181717',
        rules: [
            {
                name: 'GitHub Issues',
                description: 'Auto-group GitHub issues',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'gh-issues-domain', type: 'domain_contains', value: 'github.com' },
                    { id: 'gh-issues-path', type: 'path_contains', value: '/issues/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'GitHub Issues',
                    groupColor: '#238636'
                }
            },
            {
                name: 'GitHub PRs',
                description: 'Auto-group GitHub pull requests',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'gh-prs-domain', type: 'domain_contains', value: 'github.com' },
                    { id: 'gh-prs-path', type: 'path_contains', value: '/pull/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'GitHub PRs',
                    groupColor: '#8957e5'
                }
            },
            {
                name: 'GitHub Repos',
                description: 'Auto-group GitHub repositories',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'gh-repos-domain', type: 'domain_contains', value: 'github.com' },
                    { id: 'gh-repos-regex', type: 'url_matches_regex', value: 'github\\.com/[^/]+/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'GitHub Repos',
                    groupColor: '#181717'
                }
            }
        ]
    },
    {
        id: 'amazon',
        name: 'Amazon',
        description: 'Products',
        platform: 'amazon',
        icon: 'ShoppingCart',
        color: '#FF9900',
        rules: [
            {
                name: 'Amazon Products',
                description: 'Auto-group Amazon product pages',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'amz-products-domain', type: 'url_matches_regex', value: '://(?:www\\.)?amazon\\.(com|co\\.uk|de|fr|it|es|ca|com\\.tr|com\\.br|com\\.mx|in|jp|nl|pl|se|com\\.au|ae|sg)' },
                    { id: 'amz-products-path', type: 'path_contains', value: '/dp/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Amazon Products',
                    groupColor: '#FF9900'
                }
            }
        ]
    },
    {
        id: 'pinterest',
        name: 'Pinterest',
        description: 'Ideas, pins, and profiles',
        platform: 'pinterest',
        icon: 'Pinterest',
        color: '#E60023',
        rules: [
            {
                name: 'Pinterest Ideas',
                description: 'Auto-group Pinterest ideas',
                enabled: true,
                priority: 0,
                conditions: [
                    { id: 'pt-ideas-domain', type: 'domain_contains', value: 'pinterest.com' },
                    { id: 'pt-ideas-path', type: 'path_contains', value: '/ideas/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Pinterest Ideas',
                    groupColor: '#E60023'
                }
            },
            {
                name: 'Pinterest Pins',
                description: 'Auto-group Pinterest pins',
                enabled: true,
                priority: 1,
                conditions: [
                    { id: 'pt-pins-domain', type: 'domain_contains', value: 'pinterest.com' },
                    { id: 'pt-pins-path', type: 'path_contains', value: '/pin/' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Pinterest Pins',
                    groupColor: '#E60023'
                }
            },
            {
                name: 'Pinterest Profiles',
                description: 'Auto-group Pinterest profiles',
                enabled: true,
                priority: 2,
                conditions: [
                    { id: 'pt-profiles-domain', type: 'domain_contains', value: 'pinterest.com' },
                    { id: 'pt-profiles-regex', type: 'url_matches_regex', value: 'pinterest\\.com/[^/]+/?$' }
                ],
                action: {
                    type: 'add_to_or_create',
                    newGroupName: 'Pinterest Profiles',
                    groupColor: '#E60023'
                }
            }
        ]
    }
];
