const API = 'https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';

export async function trainerAccess(lesson, fetcher=fetch) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetcher(`${API}/api/public/trainers/${encodeURIComponent(lesson.id)}/${encodeURIComponent(lesson.version)}/access`,{cache:'no-store',credentials:'omit',signal:controller.signal});
    if(!response.ok)throw new Error('access-unavailable');
    const result=await response.json();
    if(result.schemaVersion!=='kodislovo.trainer-access.v1'||result.packId!==lesson.id||result.packVersion!==lesson.version||typeof result.enabled!=='boolean')throw new Error('invalid-access');
    return result.enabled;
  }catch(error){throw new Error('Не удалось проверить доступ. Проверь подключение к интернету и попробуй ещё раз.');}
  finally{clearTimeout(timer);}
}
