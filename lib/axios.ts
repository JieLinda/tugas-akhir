import axios from 'axios';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const api = axios.create({
  baseURL: basePath || '',
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
