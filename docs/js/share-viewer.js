// BlueTab Share Viewer JavaScript

class ShareViewer {
  constructor() {
    this.shareId = null;
    this.shareData = null;
    this.init();
  }

  init() {
    this.getShareIdFromUrl();
    this.setupEventListeners();
    
    if (this.shareId) {
      this.loadShare();
    } else {
      this.showNoShareId();
    }
  }

  getShareIdFromUrl() {
    const hash = window.location.hash.slice(1);
    const urlParams = new URLSearchParams(window.location.search);
    
    this.shareId = hash || urlParams.get('id') || urlParams.get('share');
  }

  setupEventListeners() {
    document.getElementById('importBtn')?.addEventListener('click', () => {
      this.importToBlueTab();
    });

    document.getElementById('copyLinkBtn')?.addEventListener('click', () => {
      this.copyShareLink();
    });
  }

  async loadShare() {
    try {
      this.showLoading();
      
      // GitHub Pages'den paylaşım verisini yükle
      const response = await fetch(`shares/${this.shareId}.json`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Paylaşım bulunamadı`);
      }

      this.shareData = await response.json();
      this.displayShare();
      
    } catch (error) {
      console.error('Paylaşım yükleme hatası:', error);
      this.showError();
    }
  }

  displayShare() {
    this.hideLoading();
    document.getElementById('shareContent').style.display = 'block';

    const titleEl = document.getElementById('shareTitle');
    const dataEl = document.getElementById('shareData');
    const dateEl = document.getElementById('shareDate');

    // Başlık ayarla
    if (this.shareData.type === 'group') {
      titleEl.innerHTML = `<i class="fas fa-folder mr-2"></i>${this.shareData.name}`;
      dataEl.innerHTML = this.renderSingleGroup(this.shareData);
    } else if (this.shareData.type === 'collection') {
      titleEl.innerHTML = `<i class="fas fa-layer-group mr-2"></i>${this.shareData.groups.length} Grup Koleksiyonu`;
      dataEl.innerHTML = this.renderGroupCollection(this.shareData.groups);
    }

    // Tarih ayarla
    const date = new Date(this.shareData.timestamp);
    dateEl.textContent = date.toLocaleString('tr-TR');

    // Sayfa başlığını güncelle
    document.title = `${this.shareData.name || 'BlueTab Paylaşımı'} - BlueTab`;
  }

  renderSingleGroup(groupData) {
    return this.renderGroup(groupData, true);
  }

  renderGroupCollection(groups) {
    return groups.map(group => this.renderGroup(group, false)).join('');
  }

  renderGroup(group, isSingle = false) {
    const tagsHtml = this.renderTags(group.tags || []);
    const tabsHtml = this.renderTabs(group.tabs || []);

    return `
      <div class="group-box">
        <div class="group-header">
          <div class="level">
            <div class="level-left">
              <div>
                <h3 class="title is-4 mb-2">
                  <i class="fas fa-folder-open mr-2 has-text-primary"></i>
                  ${group.name || 'İsimsiz Grup'}
                </h3>
                ${tagsHtml}
              </div>
            </div>
            <div class="level-right">
              <div class="tags">
                <span class="tag is-info">
                  <i class="fas fa-globe mr-1"></i>
                  ${group.tabs.length} sekme
                </span>
                ${group.isStarred ? '<span class="tag is-warning"><i class="fas fa-star"></i></span>' : ''}
                ${group.isLocked ? '<span class="tag is-danger"><i class="fas fa-lock"></i></span>' : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="group-content">
          ${tabsHtml}
        </div>
      </div>
    `;
  }

  renderTags(tags) {
    if (!tags || tags.length === 0) return '';
    
    const tagsHtml = tags.map(tag => `
      <span class="tag" style="background-color: ${tag.color}; color: ${this.getContrastColor(tag.color)}">
        ${tag.name}
      </span>
    `).join('');

    return `<div class="tags">${tagsHtml}</div>`;
  }

  renderTabs(tabs) {
    if (!tabs || tabs.length === 0) {
      return '<div class="tab-item has-text-grey-light">Bu grupta sekme bulunmuyor</div>';
    }

    return tabs.map(tab => `
      <div class="tab-item">
        <img src="${tab.favIconUrl || this.getDefaultIcon()}" 
             alt="Site ikonu" 
             onerror="this.src='${this.getDefaultIcon()}'">
        <div class="is-flex-grow-1">
          <a href="${tab.url}" 
             target="_blank" 
             rel="noopener noreferrer" 
             class="has-text-link is-block"
             title="${tab.url}">
            ${this.escapeHtml(tab.title || tab.url)}
          </a>
          <small class="has-text-grey">${this.getDomainFromUrl(tab.url)}</small>
        </div>
        <a href="${tab.url}" 
           target="_blank" 
           rel="noopener noreferrer" 
           class="button is-small is-light">
          <i class="fas fa-external-link-alt"></i>
        </a>
      </div>
    `).join('');
  }

  getContrastColor(hexcolor) {
    // Hex renk kodunu RGB'ye çevir
    const r = parseInt(hexcolor.substr(1,2),16);
    const g = parseInt(hexcolor.substr(3,2),16);
    const b = parseInt(hexcolor.substr(5,2),16);
    
    // YIQ hesapla
    const yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
  }

  getDefaultIcon() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iIzZCNzI4MCIvPgo8L3N2Zz4K';
  }

  getDomainFromUrl(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async importToBlueTab() {
    try {
      // BlueTab uzantısının yüklü olup olmadığını kontrol et
      if (!this.isBlueTabInstalled()) {
        this.showBlueTabNotInstalled();
        return;
      }

      // İçe aktarma verilerini hazırla
      const importData = {
        action: 'import-share',
        data: this.shareData,
        timestamp: Date.now()
      };

      // BlueTab uzantısına mesaj gönder
      chrome.runtime.sendMessage('BLUETAB_EXTENSION_ID', importData, (response) => {
        if (chrome.runtime.lastError) {
          console.error('İçe aktarma hatası:', chrome.runtime.lastError);
          this.showImportError();
        } else {
          this.showImportSuccess();
        }
      });

    } catch (error) {
      console.error('İçe aktarma hatası:', error);
      this.showImportError();
    }
  }

  isBlueTabInstalled() {
    // Bu fonksiyon normalde Chrome uzantısı API'si ile çalışır
    // Web sayfasından uzantı kontrolü sınırlı olduğu için
    // kullanıcıyı yönlendirme yapacağız
    return false;
  }

  showBlueTabNotInstalled() {
    if (confirm('BlueTab uzantısı yüklü değil. Chrome Web Store\'a yönlendirilsin mi?')) {
      window.open('https://chrome.google.com/webstore', '_blank');
    }
  }

  showImportSuccess() {
    document.getElementById('importSuccess').style.display = 'block';
    setTimeout(() => {
      document.getElementById('importSuccess').style.display = 'none';
    }, 5000);
  }

  showImportError() {
    alert('İçe aktarma sırasında hata oluştu. BlueTab uzantısının yüklü ve güncel olduğundan emin olun.');
  }

  async copyShareLink() {
    try {
      const shareUrl = window.location.href;
      await navigator.clipboard.writeText(shareUrl);
      
      // Geçici bildirim göster
      const btn = document.getElementById('copyLinkBtn');
      const originalText = btn.innerHTML;
      btn.innerHTML = '<span class="icon"><i class="fas fa-check"></i></span><span>Kopyalandı!</span>';
      btn.classList.add('is-success');
      
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('is-success');
      }, 2000);
      
    } catch (error) {
      console.error('Link kopyalama hatası:', error);
      alert('Link kopyalanamadı');
    }
  }

  showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
  }

  hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
  }

  showError() {
    this.hideLoading();
    document.getElementById('errorMessage').style.display = 'block';
  }

  showNoShareId() {
    this.hideLoading();
    document.getElementById('noShareId').style.display = 'block';
  }
}

// Sayfa yüklendiğinde başlat
document.addEventListener('DOMContentLoaded', () => {
  new ShareViewer();
});
