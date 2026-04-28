#!/bin/bash
set -e

# System deps
apt-get update -qq
apt-get install -y -qq git python3 python3-venv python3-pip

# Create george user home
useradd -m -s /bin/bash george || true
mkdir -p /home/george/Documents

# Clone both dashboards
git clone https://github.com/georgenijo/whoop-dashboard.git /home/george/Documents/whoop-dashboard
git clone https://github.com/georgenijo/oura-dashboard.git /home/george/Documents/oura-dashboard

# Set up venvs
python3 -m venv /home/george/Documents/whoop-dashboard/venv
/home/george/Documents/whoop-dashboard/venv/bin/pip install -q -r /home/george/Documents/whoop-dashboard/requirements.txt

python3 -m venv /home/george/Documents/oura-dashboard/venv
/home/george/Documents/oura-dashboard/venv/bin/pip install -q -r /home/george/Documents/oura-dashboard/requirements.txt

chown -R george:george /home/george/Documents

# Install systemd units
cp /home/george/Documents/whoop-dashboard/systemd/*.service /etc/systemd/system/
cp /home/george/Documents/whoop-dashboard/systemd/*.timer /etc/systemd/system/
cp /home/george/Documents/oura-dashboard/systemd/*.service /etc/systemd/system/
cp /home/george/Documents/oura-dashboard/systemd/*.timer /etc/systemd/system/

systemctl daemon-reload
systemctl enable whoop-dashboard whoop-sync.timer
systemctl enable oura-dashboard oura-sync.timer

# NOTE: .env files with API credentials must be added manually before starting services
# whoop: /home/george/Documents/whoop-dashboard/.env
# oura:  /home/george/Documents/oura-dashboard/.env
