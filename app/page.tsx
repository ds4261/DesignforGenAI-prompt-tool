import { redirect } from 'next/navigation'

export default function Home() {
    redirect(process.env.APP_MODE === 'chains' ? '/chains' : '/admin')
}
