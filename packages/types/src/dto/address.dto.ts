export type ContactType = 'myself' | 'other';

export interface CreateAddressRequest {
  label?: string;
  street: string;
  landmark: string;
  locality: string;
  city?: string;
  pincode: string;
  lat: number;
  lng: number;
  // Receiver / contact details (Address redesign v2)
  contactType?: ContactType;
  receiverName?: string;
  receiverPhone?: string;
  mapsLink?: string;
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
  contactType?: ContactType | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  mapsLink?: string | null;
  isDefault: boolean;
  createdAt: string;
}
