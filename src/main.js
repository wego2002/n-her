const socket = io();
const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([51.1657, 10.4515], 6);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap-Mitwirkende' }).addTo(map);

let sessionId = null;
let selfId = null;
let myMarker = null;
let accuracyCircle = null;
let sharing = false;
let watchId = null;
const remoteMarkers = new Map();
const people = new Map();
const toast = document.querySelector('#toast');
const sharingText = document.querySelector('#sharing-text');
const sharingButton = document.querySelector('#sharing-toggle');

function notify(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 3200); }
function myIcon() { return L.divIcon({ className: 'custom-marker', html: '<div class="me-pin">Du</div>', iconSize: [35, 35], iconAnchor: [17, 17] }); }
function personIcon(name) { return L.divIcon({ className: 'custom-marker', html: `<div class="person-pin"><span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span><b>${escapeHtml(name)}</b></div>`, iconSize: [42, 56], iconAnchor: [21, 42] }); }
function escapeHtml(value) { const element = document.createElement('div'); element.textContent = value; return element.innerHTML; }

function setMyLocation(position) {
  const latlng = [position.coords.latitude, position.coords.longitude];
  if (!myMarker) myMarker = L.marker(latlng, { icon: myIcon(), title: 'Dein Standort' }).addTo(map);
  else myMarker.setLatLng(latlng).addTo(map);
  if (accuracyCircle) accuracyCircle.remove();
  accuracyCircle = L.circle(latlng, { radius: position.coords.accuracy, color: '#2f7ed7', weight: 1, fillColor: '#2f7ed7', fillOpacity: .1, interactive: false }).addTo(map);
  map.flyTo(latlng, Math.max(map.getZoom(), 16), { duration: .8 });
  document.querySelector('#place-label').textContent = `Genauigkeit ±${Math.round(position.coords.accuracy)} m`;
  document.querySelector('#map-hint').classList.add('hidden');
  if (sharing && sessionId) socket.emit('location:update', { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
}

function locationError(error) { const messages = { 1: 'Standortzugriff wurde nicht erlaubt.', 2: 'GPS-Signal ist gerade nicht verfügbar.', 3: 'GPS-Anfrage hat zu lange gedauert.' }; notify(messages[error.code] || 'Standort konnte nicht ermittelt werden.'); }
function locateOnce() { if (!navigator.geolocation) return notify('Dein Browser unterstützt keinen Standortzugriff.'); navigator.geolocation.getCurrentPosition(setMyLocation, locationError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }); }
function beginTracking() { if (!navigator.geolocation || watchId !== null) return; watchId = navigator.geolocation.watchPosition(setMyLocation, locationError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }); }
function stopTracking() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; }

function renderPeople() {
  const list = document.querySelector('#invite-list');
  const remote = [...people.values()].filter(person => person.id !== selfId);
  list.replaceChildren();
  document.querySelector('#empty-state').hidden = remote.length > 0;
  document.querySelector('#people-title').textContent = remote.length ? `${remote.length} ${remote.length === 1 ? 'Person teilt' : 'Personen teilen'}` : 'Noch niemand dabei';
  remote.forEach(person => {
    const row = document.createElement('div'); row.className = 'pending-invite';
    const avatar = document.createElement('span'); avatar.className = 'pending-avatar'; avatar.textContent = person.name.slice(0, 1).toUpperCase();
    const copy = document.createElement('span'); const name = document.createElement('strong'); name.textContent = person.name; const status = document.createElement('small'); status.textContent = person.lat === null ? 'Standort noch nicht freigegeben' : `Live · Genauigkeit ±${Math.round(person.accuracy || 0)} m`; copy.append(name, status);
    const action = document.createElement('button'); action.className = 'person-focus'; action.textContent = person.lat === null ? 'wartet' : 'Karte'; action.disabled = person.lat === null; action.addEventListener('click', () => map.flyTo([person.lat, person.lng], 17));
    row.append(avatar, copy, action); list.append(row);
  });
}

function updateRemoteMarker(person) {
  if (person.id === selfId || person.lat === null) return;
  people.set(person.id, person);
  const latlng = [person.lat, person.lng];
  const existing = remoteMarkers.get(person.id);
  if (existing) existing.setLatLng(latlng).setIcon(personIcon(person.name));
  else remoteMarkers.set(person.id, L.marker(latlng, { icon: personIcon(person.name), title: person.name }).addTo(map).bindPopup(`<strong>${escapeHtml(person.name)}</strong><br>Genauigkeit ±${Math.round(person.accuracy || 0)} m`));
  renderPeople();
}

function useSession(data) {
  sessionId = data.sessionId; selfId = data.selfId;
  people.clear(); data.people.forEach(person => people.set(person.id, person));
  renderPeople();
  document.querySelector('#invite-link').value = `${location.origin}${location.pathname}?room=${sessionId}`;
}

socket.on('people:update', data => { const ids = new Set(data.map(person => person.id)); for (const [id, marker] of remoteMarkers) if (!ids.has(id)) { marker.remove(); remoteMarkers.delete(id); } people.clear(); data.forEach(person => people.set(person.id, person)); renderPeople(); });
socket.on('person:location', updateRemoteMarker);
socket.on('disconnect', () => notify('Verbindung zum Live-Server verloren.'));

const roomFromUrl = new URLSearchParams(location.search).get('room');
socket.on('connect', () => {
  if (roomFromUrl) {
    document.querySelector('#join-dialog').showModal();
    return;
  }

  document.querySelector('#create-dialog').showModal();
});
document.querySelector('#create-form').addEventListener('submit', event => {
  event.preventDefault();

const name = document.querySelector('#create-name').value.trim();

if (!name) {
    notify("Bitte gib einen Namen ein.");
    return;
}

  socket.emit('session:create', name, data => {
    document.querySelector('#create-dialog').close();
    useSession(data);
    notify('Kreis erstellt.');
  });
});

document.querySelector('#join-form').addEventListener('submit', event => { event.preventDefault(); const name = document.querySelector('#join-name').value.trim(); socket.emit('session:join', { sessionId: roomFromUrl, name }, data => { if (!data.ok) return notify(data.error); document.querySelector('#join-dialog').close(); useSession(data); notify('Du bist dem Kreis beigetreten.'); }); });
document.querySelector('#locate-button').addEventListener('click', locateOnce);
document.querySelector('#profile-button').addEventListener('click', () => notify('Profil-Einstellungen folgen als nächstes.'));
document.querySelector('#invite-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());
document.querySelector('#invite-form').addEventListener('submit', event => event.preventDefault());
document.querySelector('#copy-invite').addEventListener('click', async () => { try { await navigator.clipboard.writeText(document.querySelector('#invite-link').value); notify('Einladungslink kopiert.'); } catch { notify('Link markieren und kopieren.'); } });
sharingButton.addEventListener('click', () => { sharing = !sharing; sharingButton.textContent = sharing ? 'Teilen pausieren' : 'Teilen aktivieren'; sharingText.textContent = sharing ? 'Dein Standort wird live und präzise aktualisiert.' : 'Dein Standort ist privat, bis du ihn bewusst teilst.'; if (sharing) { beginTracking(); locateOnce(); notify('Live-Standortfreigabe aktiviert.'); } else { stopTracking(); notify('Standortfreigabe pausiert.'); } });
window.addEventListener('load', () => setTimeout(() => map.invalidateSize(), 50));
new ResizeObserver(() => map.invalidateSize()).observe(document.querySelector('.map-section'));



document.querySelectorAll('.modal-close').forEach(button => {
  button.addEventListener('click', () => {
    button.closest('dialog').close();
  });
});