import React from 'react';
import Avatar from 'react-avatar';

// Same color generation as Editor for consistency
const getUserColor = (username) => {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
};

function Client({username, isHost}) {
  const userColor = getUserColor(username.toString());

  return (
    <div className="d-flex align-items-center mb-3">
      <Avatar 
        name={username.toString()} 
        size={50} 
        round="14px" 
        className="mr-3"
        color={userColor}
      />
      <span className='mx-2'>{username.toString()} {isHost && '(Host)'}</span>
    </div>
  );
}

export default Client;
