import axios from 'axios'
import { supabase } from './supabase'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach Supabase JWT on every request
api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

// Surface API errors cleanly, preserving the HTTP status code on the Error object.
export class ApiError extends Error {
  constructor(message: string, public readonly status: number | undefined) {
    super(message)
    this.name = 'ApiError'
  }
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const message = err.response?.data?.detail || err.message || 'Something went wrong'
    return Promise.reject(new ApiError(message, err.response?.status))
  }
)

export default api
