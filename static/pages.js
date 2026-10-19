const KEY = "avonent_os_static_v1";

function emptyData() {
  return { brands: [], products: [], plans: [], creatives: [] };
}
function loadData() {
  try {
    return Object.assign(emptyData(), JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch (e) {
    return emptyData();
  }
}
function saveData(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}
function uid() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function(m) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m];
  });
}
function newest(a,b) {
  return new Date(b.createdAt) - new Date(a.createdAt);
}
function productName(data, id) {
  var x = data.products.find(function(p){ return p.id === id; });
  return x ? x.name : "Unassigned product";
}
function brandName(data, id) {
  var x = data.brands.find(function(b){ return b.id === id; });
  return x ? x.name : "Unassigned brand";
}
function setText(id, value) {
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

function initDashboard(data) {
  setText("stat-brands", data.brands.length);
  setText("stat-products", data.products.length);
  setText("stat-plans", data.plans.length);
  setText("stat-creatives", data.creatives.length);

  var plans = document.getElementById("recent-plans");
  if (plans) {
    var p = data.plans.slice().sort(newest).slice(0,5);
    plans.innerHTML = p.length ? p.map(function(x){
      return '<div class="list-item"><h3>'+esc(x.title)+'</h3><div class="meta">'+esc(x.type)+'</div><p>'+esc(x.body).slice(0,180)+'</p></div>';
    }).join("") : '<div class="empty">No plans yet.</div>';
  }

  var creatives = document.getElementById("recent-creatives");
  if (creatives) {
    var c = data.creatives.slice().sort(newest).slice(0,5);
    creatives.innerHTML = c.length ? c.map(function(x){
      return '<div class="list-item"><h3>'+esc(x.title)+'</h3><div class="meta">'+esc(productName(data,x.productId))+' · '+esc(x.status)+'</div><p>'+esc(x.hook || "No hook yet.")+'</p></div>';
    }).join("") : '<div class="empty">No creatives yet.</div>';
  }

  var status = document.getElementById("storage-status");
  if (status) status.textContent = "Saved locally in this browser. Export a backup before clearing browser data or changing devices.";

  var exportBtn = document.getElementById("export-data");
  if (exportBtn) exportBtn.onclick = function() {
    var blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "avonent-os-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  var importInput = document.getElementById("import-data");
  if (importInput) importInput.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function(text){
      try {
        var parsed = JSON.parse(text);
        saveData(Object.assign(emptyData(), parsed));
        location.reload();
      } catch (err) {
        alert("Invalid Avonent OS backup file.");
      }
    });
  };

  var clearBtn = document.getElementById("clear-data");
  if (clearBtn) clearBtn.onclick = function() {
    if (confirm("Delete all Avonent OS test data stored in this browser?")) {
      localStorage.removeItem(KEY);
      location.reload();
    }
  };
}

function initBrands(data) {
  var form = document.getElementById("brand-form");
  var name = document.getElementById("brand-name");
  var search = document.getElementById("brand-search");
  var list = document.getElementById("brand-list");

  function render() {
    var q = (search.value || "").toLowerCase();
    var rows = data.brands.filter(function(b){ return b.name.toLowerCase().indexOf(q) >= 0; }).sort(function(a,b){ return a.name.localeCompare(b.name); });
    list.innerHTML = rows.length ? rows.map(function(b){
      var count = data.products.filter(function(p){ return p.brandId === b.id; }).length;
      return '<div class="list-item"><h3>'+esc(b.name)+'</h3><div class="meta">'+count+' products</div><div class="card-actions"><button class="secondary mini" data-delete-brand="'+b.id+'">Delete</button></div></div>';
    }).join("") : '<div class="empty">No brands found.</div>';
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    var v = name.value.trim();
    if (!v) return;
    data.brands.push({id:uid(), name:v, createdAt:new Date().toISOString()});
    saveData(data);
    form.reset();
    render();
  };
  search.oninput = render;
  list.onclick = function(e) {
    var id = e.target.getAttribute("data-delete-brand");
    if (!id) return;
    if (!confirm("Delete this brand? Products will become unassigned.")) return;
    data.brands = data.brands.filter(function(b){ return b.id !== id; });
    data.products = data.products.map(function(p){ if (p.brandId === id) p.brandId = ""; return p; });
    saveData(data);
    render();
  };
  render();
}

function initProducts(data) {
  var form = document.getElementById("product-form");
  var brand = document.getElementById("product-brand");
  var search = document.getElementById("product-search");
  var list = document.getElementById("product-list");

  function fillBrands() {
    brand.innerHTML = '<option value="">Unassigned</option>' + data.brands.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(b){
      return '<option value="'+b.id+'">'+esc(b.name)+'</option>';
    }).join("");
  }
  function render() {
    var q = (search.value || "").toLowerCase();
    var rows = data.products.filter(function(p){
      return [p.name,p.category,p.notes,brandName(data,p.brandId)].join(" ").toLowerCase().indexOf(q) >= 0;
    }).sort(newest);
    list.innerHTML = rows.length ? rows.map(function(p){
      var price = p.price ? ' · $'+Number(p.price).toFixed(2) : '';
      return '<div class="card"><h3>'+esc(p.name)+'</h3><div class="meta">'+esc(brandName(data,p.brandId))+' · '+esc(p.category || "Uncategorized")+price+'</div><p>'+esc(p.notes || "No notes yet.")+'</p><div class="card-actions"><button class="secondary mini" data-delete-product="'+p.id+'">Delete</button></div></div>';
    }).join("") : '<div class="empty">No products found.</div>';
  }

  fillBrands();
  form.onsubmit = function(e) {
    e.preventDefault();
    data.products.push({
      id:uid(),
      brandId:brand.value,
      name:document.getElementById("product-name").value.trim(),
      category:document.getElementById("product-category").value.trim(),
      price:document.getElementById("product-price").value,
      notes:document.getElementById("product-notes").value.trim(),
      createdAt:new Date().toISOString()
    });
    saveData(data);
    form.reset();
    fillBrands();
    render();
  };
  search.oninput = render;
  list.onclick = function(e) {
    var id = e.target.getAttribute("data-delete-product");
    if (!id) return;
    if (!confirm("Delete this product?")) return;
    data.products = data.products.filter(function(p){ return p.id !== id; });
    data.creatives = data.creatives.map(function(c){ if (c.productId === id) c.productId = ""; return c; });
    saveData(data);
    render();
  };
  render();
}

function initPlans(data) {
  var form = document.getElementById("plan-form");
  var search = document.getElementById("plan-search");
  var list = document.getElementById("plan-list");

  function render() {
    var q = (search.value || "").toLowerCase();
    var rows = data.plans.filter(function(p){ return [p.title,p.type,p.body].join(" ").toLowerCase().indexOf(q) >= 0; }).sort(newest);
    list.innerHTML = rows.length ? rows.map(function(p){
      return '<div class="list-item"><div class="section-head"><div><span class="pill">'+esc(p.type)+'</span><h3>'+esc(p.title)+'</h3></div></div><p class="pre">'+esc(p.body)+'</p><div class="card-actions"><button class="secondary mini" data-edit-plan="'+p.id+'">Edit</button><button class="secondary mini" data-delete-plan="'+p.id+'">Delete</button></div></div>';
    }).join("") : '<div class="empty">No plans found.</div>';
  }

  form.onsubmit = function(e) {
    e.preventDefault();
    data.plans.push({
      id:uid(),
      title:document.getElementById("plan-title").value.trim(),
      type:document.getElementById("plan-type").value,
      body:document.getElementById("plan-body").value.trim(),
      createdAt:new Date().toISOString()
    });
    saveData(data);
    form.reset();
    render();
  };
  search.oninput = render;
  list.onclick = function(e) {
    var did = e.target.getAttribute("data-delete-plan");
    if (did) {
      if (confirm("Delete this plan?")) {
        data.plans = data.plans.filter(function(p){ return p.id !== did; });
        saveData(data); render();
      }
      return;
    }
    var eid = e.target.getAttribute("data-edit-plan");
    if (eid) {
      var p = data.plans.find(function(x){ return x.id === eid; });
      var t = prompt("Plan title", p.title);
      if (t === null) return;
      var b = prompt("Plan", p.body);
      if (b === null) return;
      p.title = t.trim();
      p.body = b;
      saveData(data);
      render();
    }
  };
  render();
}

function initCreatives(data) {
  var form = document.getElementById("creative-form");
  var product = document.getElementById("creative-product");
  var search = document.getElementById("creative-search");
  var list = document.getElementById("creative-list");

  function fillProducts() {
    product.innerHTML = '<option value="">Unassigned</option>' + data.products.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(p){
      return '<option value="'+p.id+'">'+esc(p.name)+'</option>';
    }).join("");
  }
  function render() {
    var q = (search.value || "").toLowerCase();
    var rows = data.creatives.filter(function(c){
      return [c.title,c.angle,c.hook,c.script,c.primaryText,c.headline,productName(data,c.productId)].join(" ").toLowerCase().indexOf(q) >= 0;
    }).sort(newest);
    list.innerHTML = rows.length ? rows.map(function(c){
      return '<div class="creative-item"><div class="section-head"><div><span class="pill">'+esc(c.status)+'</span><h3>'+esc(c.title)+'</h3></div><div class="meta">'+esc(productName(data,c.productId))+' · '+esc(c.format)+'</div></div><p><strong>Angle:</strong> '+esc(c.angle || "—")+'</p><p><strong>Hook:</strong> '+esc(c.hook || "—")+'</p><details><summary>Open script and copy</summary><p class="pre">'+esc(c.script || "")+'</p><p><strong>Primary text:</strong> '+esc(c.primaryText || "")+'</p><p><strong>Headline:</strong> '+esc(c.headline || "")+'</p></details><div class="card-actions"><button class="secondary mini" data-status="'+c.id+'">Change status</button><button class="secondary mini" data-delete-creative="'+c.id+'">Delete</button></div></div>';
    }).join("") : '<div class="empty">No creatives found.</div>';
  }

  fillProducts();
  form.onsubmit = function(e) {
    e.preventDefault();
    data.creatives.push({
      id:uid(),
      productId:product.value,
      format:document.getElementById("creative-format").value,
      title:document.getElementById("creative-title").value.trim(),
      angle:document.getElementById("creative-angle").value.trim(),
      hook:document.getElementById("creative-hook").value.trim(),
      script:document.getElementById("creative-script").value.trim(),
      primaryText:document.getElementById("creative-primary").value.trim(),
      headline:document.getElementById("creative-headline").value.trim(),
      status:document.getElementById("creative-status").value,
      createdAt:new Date().toISOString()
    });
    saveData(data);
    form.reset();
    fillProducts();
    render();
  };
  search.oninput = render;
  list.onclick = function(e) {
    var did = e.target.getAttribute("data-delete-creative");
    if (did) {
      if (confirm("Delete this creative?")) {
        data.creatives = data.creatives.filter(function(c){ return c.id !== did; });
        saveData(data); render();
      }
      return;
    }
    var sid = e.target.getAttribute("data-status");
    if (sid) {
      var c = data.creatives.find(function(x){ return x.id === sid; });
      var statuses = ["Idea","Research","Brief","Editing","Review","Approved","Launched","Winner","Loser","Retest"];
      var v = prompt("Status: "+statuses.join(", "), c.status);
      if (v === null) return;
      var match = statuses.find(function(s){ return s.toLowerCase() === v.trim().toLowerCase(); });
      if (match) c.status = match;
      saveData(data);
      render();
    }
  };
  render();
}

document.addEventListener("DOMContentLoaded", function() {
  var data = loadData();
  var page = document.body.getAttribute("data-page");
  if (page === "dashboard") initDashboard(data);
  if (page === "brands") initBrands(data);
  if (page === "products") initProducts(data);
  if (page === "plans") initPlans(data);
  if (page === "creatives") initCreatives(data);
});