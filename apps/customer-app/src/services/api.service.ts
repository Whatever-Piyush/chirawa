import { ChirawaApiClient } from '@chirawa/api-client';
import { StorageService } from './storage.service';

// Physical device: replace with your Mac's LAN IP (shown in Metro output as exp://X.X.X.X:8081)
// Android emulator: use http://10.0.2.2:3000
// iOS simulator:    use http://localhost:3000
const DEV_HOST = '192.168.1.5'; // <-- update this to match your current LAN IP
const API_URL = __DEV__
  ? `http://${DEV_HOST}:3000/api/v1`
  : 'https://api.chirawa.in/api/v1';

export const api = new ChirawaApiClient(API_URL, StorageService);
