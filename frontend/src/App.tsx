import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AppShell from './components/layout/AppShell'
import AuthGuard from './components/auth/AuthGuard'

// Pages
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import Onboarding from './pages/Onboarding'
import Feed from './pages/Feed'
import VlogDetail from './pages/VlogDetail'
import Trips from './pages/Trips'
import TripDetail from './pages/TripDetail'
import Booking from './pages/Booking'
import BookingConfirmation from './pages/BookingConfirmation'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/" element={session ? <Navigate to="/feed" replace /> : <Landing />} />
        <Route path="/login" element={session ? <Navigate to="/feed" replace /> : <Login />} />
        <Route path="/signup" element={session ? <Navigate to="/feed" replace /> : <Signup />} />
        <Route path="/auth/callback" element={<OAuthCallbackPage />} />

        {/* Protected */}
        <Route element={<AuthGuard />}>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<AppShell />}>
            <Route path="/feed" element={<Feed />} />
            <Route path="/vlogs/:id" element={<VlogDetail />} />
            <Route path="/trips" element={<Trips />} />
            <Route path="/trips/:id" element={<TripDetail />} />
            <Route path="/booking" element={<Booking />} />
            <Route path="/booking/confirmation" element={<BookingConfirmation />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
