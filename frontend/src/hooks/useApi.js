import {useState, useCallback} from 'react';

const useApi = (baseURL = import.meta.env.VITE_SERVER_URL) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const request = useCallback(
        async (endpoint, options = {}) => {
            const {
                method = 'GET',
                body = null,
                headers = {},
                ...customConfig
            } = options;

            setLoading(true);
            setError(null);

            const config = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                cache: 'no-store',
                credentials: 'include',
                ...customConfig,
            };

            if (body && method !== 'GET' && method !== 'DELETE') {
                config.body = JSON.stringify(body);
            }

            try {
                const url = `${baseURL}${endpoint}`;
                const response = await fetch(url, config);
                const contentType = response.headers.get('content-type');
                let data;

                if (contentType && contentType.includes('application/json')) {
                    data = await response.json();
                } else {
                    data = await response.text();
                }

                if (!response.ok) {
                    throw new Error(
                        data.message || `HTTP error! status: ${response.status}`
                    );
                }

                setLoading(false);
                return {
                    data: data?.data,
                    success: data?.success,
                    message: data?.message,
                    statusCode: data?.statusCode,
                };
            } catch (err) {
                setError(err.message);
                setLoading(false);
                throw err;
            }
        },
        [baseURL]
    );

    // Convenience methods
    const get = useCallback(
        (endpoint, options = {}) => {
            return request(endpoint, {...options, method: 'GET'});
        },
        [request]
    );

    const post = useCallback(
        (endpoint, body, options = {}) => {
            return request(endpoint, {...options, method: 'POST', body});
        },
        [request]
    );

    const put = useCallback(
        (endpoint, body, options = {}) => {
            return request(endpoint, {...options, method: 'PUT', body});
        },
        [request]
    );

    const del = useCallback(
        (endpoint, options = {}) => {
            return request(endpoint, {...options, method: 'DELETE'});
        },
        [request]
    );

    return {
        loading,
        error,
        get,
        post,
        put,
        delete: del,
    };
};

export default useApi;

// USAGE EXAMPLE:
/*
import useApi from '@/hooks/useApi';

function MyComponent() {
  const api = useApi();
  const [users, setUsers] = useState([]);

  // GET request
  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  };

  // POST request
  const createUser = async (userData) => {
    try {
      const { data } = await api.post('/users', userData);
      console.log('User created:', data);
    } catch (err) {
      console.error('Failed to create user:', err);
    }
  };

  // PUT request
  const updateUser = async (userId, userData) => {
    try {
      const { data } = await api.put(`/users/${userId}`, userData);
      console.log('User updated:', data);
    } catch (err) {
      console.error('Failed to update user:', err);
    }
  };

  // DELETE request
  const deleteUser = async (userId) => {
    try {
      await api.delete(`/users/${userId}`);
      console.log('User deleted');
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  return (
    <div>
      {api.loading && <Spinner />}
      {api.error && <Toast>Error: {api.error}</Toast>}
      <button onClick={fetchUsers}>Fetch Users</button>
    </div>
  );
}
*/
