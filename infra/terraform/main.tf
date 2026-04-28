terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

# VCN
resource "oci_core_vcn" "dashboards" {
  compartment_id = var.tenancy_ocid
  cidr_block     = "10.0.0.0/16"
  display_name   = "dashboards-vcn"
  dns_label      = "dashboards"
}

# Internet Gateway
resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.dashboards.id
  display_name   = "dashboards-igw"
}

# Route Table
resource "oci_core_route_table" "rt" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.dashboards.id
  display_name   = "dashboards-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.igw.id
  }
}

# Security List — allow SSH + Streamlit ports
resource "oci_core_security_list" "sl" {
  compartment_id = var.tenancy_ocid
  vcn_id         = oci_core_vcn.dashboards.id
  display_name   = "dashboards-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"
    tcp_options {
      min = 8501
      max = 8502
    }
  }
}

# Subnet
resource "oci_core_subnet" "public" {
  compartment_id    = var.tenancy_ocid
  vcn_id            = oci_core_vcn.dashboards.id
  cidr_block        = "10.0.1.0/24"
  display_name      = "dashboards-subnet"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.rt.id
  security_list_ids = [oci_core_security_list.sl.id]
}

# VM — VM.Standard.E2.1.Micro (always free, 1 OCPU, 1GB RAM)
resource "oci_core_instance" "dashboards" {
  compartment_id      = var.tenancy_ocid
  availability_domain = var.availability_domain
  shape               = "VM.Standard.E2.1.Micro"
  display_name        = "dashboards-vm"

  source_details {
    source_type = "image"
    source_id   = var.image_ocid
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    display_name     = "dashboards-vnic"
  }

  metadata = {
    ssh_authorized_keys = file(var.ssh_public_key_path)
    user_data           = base64encode(file("${path.module}/cloud-init.sh"))
  }
}

output "public_ip" {
  value = oci_core_instance.dashboards.public_ip
}
