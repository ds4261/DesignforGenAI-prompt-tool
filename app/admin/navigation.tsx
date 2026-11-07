'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { resources } from './resources'

export function AdminNavigation() {
    const pathname = usePathname()
    return <div className="nav-links">
        {[
            ['/admin', 'Dashboard'], ['/chains', 'Chain studio'], ['/admin/users', 'Users'],
            ['/admin/media', 'AI media'], ['/admin/votes', 'Votes'],
            ...Object.entries(resources).map(([slug, resource]) => [`/admin/${slug}`, resource.title]),
        ].map(([href, label]) => <Link key={href} href={href}
            aria-current={(href === '/admin' ? pathname === href : pathname.startsWith(href)) ? 'page' : undefined}>
            {label}
        </Link>)}
    </div>
}
