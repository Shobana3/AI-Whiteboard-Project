import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'https://ai-whiteboard-api.onrender.com/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

export const createSession   = (data) => api.post('/sessions', data).then(r => r.data);
export const getSession      = (id)   => api.get(`/sessions/${id}`).then(r => r.data);
export const getAllSessions   = ()     => api.get('/sessions').then(r => r.data);
export const saveDrawing     = (data) => api.post('/drawings', data).then(r => r.data);
export const getSessionDrawings = (id) => api.get(`/drawings/session/${id}`).then(r => r.data);
export const analyzeDrawing   = (data) => api.post('/predict', data).then(r => r.data);
export const getSessionPredictions = (id) => api.get(`/predictions/session/${id}`).then(r => r.data);
export const sendChatMessage = (data) => api.post('/chat', data).then(r => r.data);
export const getChatHistory  = (id, limit=50) => api.get(`/chat/session/${id}?limit=${limit}`).then(r => r.data);
export const getDrawingGuidance = (data) => api.post('/guidance', data).then(r => r.data);
export const getSessionStats = (id)   => api.get(`/stats/session/${id}`).then(r => r.data);

export default api;