# Retired Oracle infrastructure

These Terraform and cloud-init files describe the former `whoop-vm` Oracle
deployment. They are retained only as migration and audit history.

Do not run `terraform apply` to provision or update production. Current
production runs on Fleet node `opti` behind Cloudflare Tunnel; see
[`docs/operations/environment-and-deploy.md`](../../docs/operations/environment-and-deploy.md).

After the production SQLite database and environment have been recovered and
verified on `opti`, retire the Oracle resources from the owning Oracle account.
Do not use an unchecked Terraform destroy from this historical directory as a
substitute for reviewing the exact cloud resources first.
