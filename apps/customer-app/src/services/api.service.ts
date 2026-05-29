import { ChirawaApiClient } from '@chirawa/api-client';
import { StorageService } from './storage.service';
import { DEV_HOST } from '../config/devHost';

const API_URL = __DEV__
  ? `http://${DEV_HOST}:3000/api/v1`
  : 'https://api.chirawa.in/api/v1';

export const api = new ChirawaApiClient(API_URL, StorageService);
