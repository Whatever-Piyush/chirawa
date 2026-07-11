// GET /users/me — identity + role profile. `profile` is the role's own shape
// (CustomerProfile for customers); only the fields the apps read are typed.
export interface MeResponse {
  id:           string;
  phone:        string;
  role:         string;
  referralCode: string | null;
  profile: {
    id:         string;
    firstName?: string | null;
    lastName?:  string | null;
  } | null;
  createdAt: string;
}

// PUT /users/me — customer fields only (seller/rider payout fields are typed
// loosely server-side and not used by the customer app).
export interface UpdateMyProfileRequest {
  firstName?: string;
  lastName?:  string;
}
