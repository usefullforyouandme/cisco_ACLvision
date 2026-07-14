// テスト用の ASA show running-config 断片。
export const ASA_SAMPLE = `: Saved
ASA Version 9.8(2)
!
hostname FW1
names
!
interface GigabitEthernet0/0
 nameif outside
 security-level 0
 ip address 203.0.113.1 255.255.255.0
!
interface GigabitEthernet0/1
 nameif inside
 security-level 100
 ip address 10.0.0.1 255.255.255.0
!
object network WEB-SRV
 host 192.168.1.10
!
object network DMZ-NET
 subnet 192.168.1.0 255.255.255.0
!
object-group network BRANCH
 network-object host 10.10.10.1
 network-object 10.10.20.0 255.255.255.0
 group-object BRANCH-CHILD
!
object-group network BRANCH-CHILD
 network-object 10.10.30.0 255.255.255.0
!
object-group service WEB-PORTS tcp
 port-object eq www
 port-object eq https
!
access-list OUTSIDE-IN remark allow web to server
access-list OUTSIDE-IN extended permit tcp any object WEB-SRV eq https
access-list OUTSIDE-IN extended permit tcp object-group BRANCH any object-group WEB-PORTS
access-list OUTSIDE-IN extended deny ip any any log
access-list UNUSED-ACL extended permit ip any any
!
access-group OUTSIDE-IN in interface outside
!
ssh 10.0.0.0 255.255.255.0 inside
http server enable
`;
