<template>
  <div class="surface-card p-4 shadow-2 border-round about">
    <h1>What is this?</h1>
    With Microsoft shutting down AppCenter, I needed a replacement for my
    personal projects. I wanted something that was self-hosted, and had a good
    API. This is the result. While the backend is fairly solid, the frontend is
    a bit rough around the edges. I'm not a frontend developer per-se, and this
    was my first time using Vue.js. There are definitely improvements that can
    be made, and I've learned how to do things better since I started this
    project. This means that the UI is due for a rewrite, but I'm not sure when
    I'll get around to that. Luckily, the UI is only needed for developers, and
    not for end users.
    <h1>How do I use it?</h1>
    As an end user, you simply follow the links from developers hosting builds
    here. As a developer, you can use the API to upload builds, and then share
    the link to the builds with your users. The system will automatically
    publish build manifests in json format, with permalinks allowing you to
    write self-updating code. Please contact me if you want to be a registered
    developer or host your own instance.
  </div>
</template>
