// テスト用の IOS show running-config 断片。実際のコンフィグに近い体裁で用意する。
export const IOS_SAMPLE = `!
version 15.2
hostname RT01
!
ip access-list extended OUTSIDE-IN
 remark allow web to DMZ
 10 permit tcp 10.0.0.0 0.0.0.255 host 192.168.1.10 eq 443 log
 20 permit tcp object-group BRANCH-NET 192.168.1.0 0.0.0.255 eq 22
 30 deny ip any any log
!
ip access-list standard MGMT
 permit host 10.9.9.9
 permit 10.9.0.0 0.0.255.255
!
access-list 10 permit 172.16.0.0 0.0.0.255
access-list 10 deny any
access-list 100 permit tcp any host 203.0.113.5 eq 80
!
object-group network BRANCH-NET
 host 10.10.10.1
 10.10.20.0 255.255.255.0
!
interface GigabitEthernet0/0
 description uplink
 ip address 203.0.113.1 255.255.255.0
 ip access-group OUTSIDE-IN in
!
interface GigabitEthernet0/1
 description internal
 ip address 10.0.0.1 255.255.255.0
 shutdown
!
interface Vlan10
 ip address 10.9.0.1 255.255.255.0
!
line vty 0 4
 access-class MGMT in
 transport input ssh
!
snmp-server community public RO 10
ip http server
!
this-is-an-unknown-command foo bar
!
`;
