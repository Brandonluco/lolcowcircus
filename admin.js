const streamerName = document.getElementById("streamerName");
const streamerPlatform = document.getElementById("streamerPlatform");
const streamerChannel = document.getElementById("streamerChannel");
const streamerStatus = document.getElementById("streamerStatus");
const addStreamer = document.getElementById("addStreamer");
const streamerList = document.getElementById("streamerList");
const streamerSelect = document.getElementById("streamerSelect");
const alertMessage = document.getElementById("alertMessage");
const alertType = document.getElementById("alertType");
const updateAlert = document.getElementById("updateAlert");
const clearAlert = document.getElementById("clearAlert");
const currentAlert = document.getElementById("currentAlert");
const articleTitle = document.getElementById("articleTitle");
const articleDate = document.getElementById("articleDate");
const articleContentTop = document.getElementById("articleContentTop");
const articleImage = document.getElementById("articleImage");
const articleYoutube = document.getElementById("articleYoutube");
const articleContentBottom = document.getElementById("articleContentBottom");
const addArticle = document.getElementById("addArticle");
const articleList = document.getElementById("articleList");
const cancelEdit = document.getElementById("cancelEdit");
const editingStatus = document.getElementById("editingStatus");


let streamers = [];

let editingArticleIndex = null;

const onlineButton = document.getElementById("onlineButton");
const awayButton = document.getElementById("awayButton");

const offlineButton = document.getElementById("offlineButton");



onlineButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "online"
        })
    });

    await loadStreamers();

});


awayButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "away"
        })
    });

    await loadStreamers();

});


offlineButton.addEventListener("click", async function() {

    const id = streamerSelect.value;

    await fetch("/api/streamers", {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            id: id,
            status: "offline"
        })
    });

    await loadStreamers();

});


function displayStreamers() {

    

    streamerList.replaceChildren();

    streamers.forEach((streamer, index) => {

        const div = document.createElement("div");

        div.innerHTML = `
            <strong>${streamer.name}</strong>
            <p>Status: ${streamer.status}</p>
        `;

        streamerList.appendChild(div);

    });

}

async function displayCurrentAlert() {

    const response = await fetch("/api/alert");

    const alert = await response.json();

    if (!alert) {
        currentAlert.textContent = "No active alert";
        currentAlert.style.backgroundColor = "#adadad";
        currentAlert.style.color = "black";
        return;
    }

    currentAlert.textContent = alert.message;

    if (alert.type === "news") {
        currentAlert.style.backgroundColor = "#2ecc71";
    }

    if (alert.type === "maintenance") {
        currentAlert.style.backgroundColor = "#e74c3c";
    }

    currentAlert.style.color = "white";

}

function displayArticles() {

    const savedArticles = getArticles();

    articleList.innerHTML = "";

    savedArticles.forEach((article, index) => {

        const div = document.createElement("div");

div.classList.add("admin-article-card");

 div.innerHTML = `
    <strong>${article.title}</strong>

    <p>${article.date}</p>

    <p>${article.contentTop}</p>

    ${article.image ? "<p>🖼 Image attached</p>" : ""}

    ${article.youtube ? "<p>▶ YouTube attached</p>" : ""}

    <button onclick="editArticle(${index})">Edit</button>
    <button onclick="deleteArticle(${index})">Delete</button>
`;

        articleList.appendChild(div);

    });

}

function deleteArticle(index) {

    const confirmDelete = confirm("Are you sure you want to delete this article?");

    if (!confirmDelete) {
        return;
    }

    let savedArticles = getArticles();

    savedArticles.splice(index, 1);

    saveArticles(savedArticles);

    displayArticles();

}

function editArticle(index) {

    let savedArticles = getArticles();

    const article = savedArticles[index];

    articleTitle.value = article.title;
    articleDate.value = article.date;
    articleContentTop.value = article.contentTop;
    articleImage.value = article.image;
    articleYoutube.value = article.youtube;
    articleContentBottom.value = article.contentBottom;

    editingArticleIndex = index;

addArticle.textContent = "Save Changes";

cancelEdit.style.display = "inline-block";

editingStatus.textContent = "Currently editing: " + article.title;

editingStatus.style.display = "block";

document.getElementById("article-manager").scrollIntoView({
    behavior: "smooth"
});

}


onlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "online";
    saveStreamers(streamers);
    displayStreamers();
});


awayButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "away";
    saveStreamers(streamers);
    displayStreamers();
});


offlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "offline";
    saveStreamers(streamers);
    displayStreamers();
});

addStreamer.addEventListener("click", async function() {

    const newStreamer = {
        name: streamerName.value,
        platform: streamerPlatform.value,
        channel: streamerChannel.value,
        status: streamerStatus.value
    };


    await fetch("/api/streamers", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newStreamer)
    });


    streamerName.value = "";
    streamerPlatform.value = "";
    streamerChannel.value = "";


    await loadStreamers();

});

updateAlert.addEventListener("click", async function() {

    const newAlert = {
        type: alertType.value,
        message: alertMessage.value
    };


    await fetch("/api/alert", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(newAlert)
    });


    alertMessage.value = "";

    displayCurrentAlert();

});


clearAlert.addEventListener("click", async function() {

    await fetch("/api/alert", {
        method: "DELETE"
    });


    displayCurrentAlert();

});

cancelEdit.addEventListener("click", function() {

    editingArticleIndex = null;

    articleTitle.value = "";
    articleDate.value = "";
    articleContentTop.value = "";
    articleImage.value = "";
    articleYoutube.value = "";
    articleContentBottom.value = "";

    addArticle.textContent = "Publish Article";

    cancelEdit.style.display = "none";

    editingStatus.style.display = "none";

    editingStatus.textContent = "";

});

async function loadStreamers() {

    const response = await fetch("/api/streamers");

    streamers = await response.json();

    displayStreamers();

    loadStreamerDropdown();

}

addArticle.addEventListener("click", function() {

    const newArticle = {
        title: articleTitle.value,
        date: articleDate.value,
        contentTop: articleContentTop.value,
        image: articleImage.value,
        youtube: articleYoutube.value,
        contentBottom: articleContentBottom.value
    };

   let savedArticles = getArticles();

if (editingArticleIndex === null) {

    savedArticles.unshift(newArticle);

} else {

    savedArticles[editingArticleIndex] = newArticle;

    editingArticleIndex = null;

    addArticle.textContent = "Publish Article";

    cancelEdit.style.display = "none";

    editingStatus.style.display = "none";
    
    editingStatus.textContent = "";

}



saveArticles(savedArticles);

displayArticles();

console.log("Article saved!");

articleTitle.value = "";
articleDate.value = "";
articleContentTop.value = "";
articleImage.value = "";
articleYoutube.value = "";
articleContentBottom.value = "";

});


loadStreamers();
displayCurrentAlert();
displayArticles();