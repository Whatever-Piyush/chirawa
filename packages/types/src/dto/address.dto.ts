export interface CreateAddressRequest {
  label?: string;
  street: string;
  landmark: string;
  locality: string;
  city?: string;
  pincode: string;
  lat: number;
  lng: number;
  isDefault?: boolean;
}

export interface AddressResponse {
  id: string;
  label?: string | null;
  street: string;
  landmark: string;
  locality: string;
  city: string;
  pincode: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  createdAt: string;
}
