variable "tenancy_ocid" {
  default = "ocid1.tenancy.oc1..aaaaaaaaalhzpbpb3bi64eu65lo6b4xxigz7nuhy5avywutjf4xvgosi4z5a"
}

variable "user_ocid" {
  default = "ocid1.user.oc1..aaaaaaaaxojge2m7vr2j5ox3fzpo7bbpkbbxmn44xaxwcbqgc4p7dtl5qkwa"
}

variable "fingerprint" {
  default = "f2:c4:a2:5f:ff:f0:5c:73:0f:8b:54:8c:87:1e:96:29"
}

variable "private_key_path" {
  default = "~/.oci/oci_api_key.pem"
}

variable "region" {
  default = "us-ashburn-1"
}

variable "availability_domain" {
  default = "owWC:US-ASHBURN-AD-1"
}

variable "image_ocid" {
  # Ubuntu 22.04 us-ashburn-1 (2026-03-31)
  default = "ocid1.image.oc1.iad.aaaaaaaa7mo2qokepl24u7pyzk3llhmkcr3hzdvjcugp44rxzsldcvsw6i3q"
}

variable "ssh_public_key_path" {
  default = "~/.ssh/id_ed25519.pub"
}
